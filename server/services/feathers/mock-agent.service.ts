import { BadRequest } from '@feathersjs/errors';
import logger from '../../logger.js';
import { attachAppErrorHandler, handleAppError } from '../../lib/app-error-handler.js';
import { createMessageStreamWriter } from '../message-writer-factory.ts';
import {
  channelFromAgentType,
  isDispatchableUserMessage,
  parseUserRow,
  rejectTurnMismatch,
} from '../agent-message-dispatch.js';
import { resolveTurnModel } from '../../../shared/turn-model.js';
import { MOCK_AGENT_SDK } from '../../../shared/mock-agent-sdk.js';
import { isMockAgentServerEnabled } from '../agent-sdk/mock-agent-enabled.js';
import {
  MOCK_AGENT_SDK_LABEL,
  MOCK_AGENT_SERVICE_PATH,
  isMockAgentSdkEnabledForUser,
  listMockAgentModels,
} from '../agent-sdk/mock-agent-sdk-server.js';
import { registerAgentSdk } from './agent-sdks.service.js';
import { runMockAgentTurn } from '../mock/mock-agent-turn.js';
import { reviewTurnKey } from './session-review.service.js';
import type {
  AgentApp,
  AgentSessionRow,
  ChatTable,
  DbLike,
  MessageChannel,
  MessageRowLike,
} from './agent-service-types.ts';

type MockSessionState = {
  userId: number;
  abortController: AbortController;
  turnId?: number | null;
  channel?: MessageChannel;
};

export class MockAgentService {
  app!: AgentApp;
  private _messageListenerBound = false;
  private _activeSessions = new Map<string | number, MockSessionState>();

  setup(app: AgentApp) {
    this.app = app;
    if (this._messageListenerBound) return;
    this._messageListenerBound = true;
    const messages = this.app.service('messages');
    if (typeof messages?.on !== 'function') return;
    messages.on('created', (row: MessageRowLike) => {
      void this.handleMessageCreated(row).catch((err) =>
        logger.error({ err: (err as Error).message }, 'mock-agent: handleMessageCreated failed')
      );
    });
  }

  async handleTableMessageCreated(row: MessageRowLike, table: ChatTable) {
    if (!isMockAgentServerEnabled()) return;
    if (row.type !== 'user') return;

    const parsed = parseUserRow(row);
    if (!parsed || !isDispatchableUserMessage(parsed)) return;

    const sessionId = row.session_id;
    const db = this.app.get('db') as DbLike;
    const session = (await db('sessions').where({ id: sessionId }).first()) as
      AgentSessionRow | undefined;
    if (!session || session.archived_at) return;

    const channel: MessageChannel =
      table === 'session-review-messages'
        ? 'review'
        : channelFromAgentType(row.agent_type as string);
    const sdk =
      row.agent_sdk ?? (channel === 'review' ? session.review_agent_sdk : session.agent_sdk);
    if (sdk !== MOCK_AGENT_SDK) return;

    if (channel === 'chat') {
      if (session.status === 'archiving' || session.status === 'archived') return;
      if (session.repo_full_name && !session.session_path) return;
    }

    const activeKey = channel === 'review' ? reviewTurnKey(sessionId) : sessionId;
    if (this._activeSessions.has(activeKey)) {
      const activeTurnId =
        channel === 'review' ? session.active_review_turn_id : session.active_chat_turn_id;
      if (row.turn_id != null && activeTurnId != null && row.turn_id !== activeTurnId) {
        await rejectTurnMismatch(this.app, {
          session,
          row,
          channel,
          activeTurnId,
          userId: session.user_id,
        });
      }
      return;
    }

    const turnModel = resolveTurnModel(row, session);
    attachAppErrorHandler(
      this.app,
      this._runTurn(session, row, turnModel, {
        turnId: row.turn_id as number | null,
        channel,
        activeKey,
      }),
      { userId: session.user_id, sessionId }
    ).catch((err) => {
      logger.error({ sessionId, err: (err as Error).message }, 'mock-agent turn failed');
    });
  }

  async handleMessageCreated(message: MessageRowLike) {
    return this.handleTableMessageCreated(message, 'messages');
  }

  async _runTurn(
    session: AgentSessionRow,
    row: MessageRowLike,
    turnModel: { model?: string | null; modelParams?: unknown },
    meta: { turnId?: number | null; channel?: MessageChannel; activeKey?: string | number }
  ) {
    const sessionId = session.id;
    const userId = session.user_id;
    const channel: MessageChannel = meta.channel ?? 'chat';
    const activeKey = meta.activeKey ?? sessionId;
    const turnId = meta.turnId ?? null;
    const db = this.app.get('db') as DbLike;

    if (turnId != null) {
      const activeField =
        channel === 'review' ? { active_review_turn_id: turnId } : { active_chat_turn_id: turnId };
      await db('sessions').where({ id: sessionId }).update(activeField);
    }

    const model = turnModel.model ?? row.model ?? session.model ?? '';
    const writer =
      turnId != null
        ? createMessageStreamWriter(this.app, {
            sessionId,
            userId,
            turnId,
            channel,
            sessionPath: session.session_path,
            agentType: 'mock',
            model,
            modelParams: turnModel.modelParams,
          })
        : null;
    if (!writer) {
      throw new Error('mock-agent requires a turn id');
    }

    const abortController = new AbortController();
    this._activeSessions.set(activeKey, {
      userId,
      abortController,
      turnId,
      channel,
    });

    let turnFinishedOk = false;
    try {
      if (channel !== 'review') {
        await this.app
          .service('sessions')
          .patch(sessionId, { status: 'running' }, { user: { id: userId } });
        await this.app.service('sessions').onTurnStart(sessionId);
      }

      await runMockAgentTurn({
        session,
        writer,
        abortSignal: abortController.signal,
      });

      turnFinishedOk = true;
      if (channel !== 'review') {
        await this.app
          .service('sessions')
          .patch(sessionId, { status: 'completed' }, { user: { id: userId } });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError' && (err as Error).message !== 'Aborted') {
        handleAppError(this.app, err as Error, { userId, sessionId });
        logger.error({ sessionId, err: (err as Error).message }, 'mock-agent stream error');
        if (channel !== 'review') {
          await this.app
            .service('sessions')
            .patch(sessionId, { status: 'failed' }, { user: { id: userId } });
        }
        this.app.service('sessions').emit('app:error', {
          sessionId,
          message: (err as Error).message,
          user_id: userId,
        });
      }
    } finally {
      const clearField =
        channel === 'review' ? { active_review_turn_id: null } : { active_chat_turn_id: null };
      await db('sessions')
        .where({ id: sessionId })
        .update(clearField)
        .catch(() => {});
      this._activeSessions.delete(activeKey);
    }

    if (turnFinishedOk && channel !== 'review') {
      await this.app
        .service('sessions')
        .onTurnComplete(sessionId)
        .catch((err) => {
          logger.warn(
            { sessionId, err: (err as Error).message },
            'mock-agent: failed to flush queued messages'
          );
        });
    }
  }

  async stopSession(sessionId: number) {
    await this.stopTurn(sessionId);
  }

  async stopTurn(activeKey: string | number) {
    const state = this._activeSessions.get(activeKey);
    if (state) {
      state.abortController.abort();
      this._activeSessions.delete(activeKey);
    }
  }

  async get(id: number) {
    return this._activeSessions.get(id) ?? null;
  }

  async isEnabled(_ctx?: {
    user?: Record<string, unknown>;
    repo?: Record<string, unknown> | null;
  }) {
    return isMockAgentSdkEnabledForUser(_ctx ?? {});
  }

  async listModels(
    ctx: { user?: Record<string, unknown>; repo?: Record<string, unknown> | null },
    _opts?: { refresh?: boolean }
  ) {
    if (ctx?.repo?.id == null) {
      throw new BadRequest('repo_id is required');
    }
    return listMockAgentModels();
  }

  async generateSessionMetadata(
    _initialPrompt: string,
    shortId = '',
    _user: unknown = null,
    _repo: unknown = null
  ): Promise<{ label: string; branchName: string }> {
    return { label: '', branchName: `task-${shortId}` };
  }

  async isInterruptedSessionResumable(
    _session: AgentSessionRow,
    _opts?: { channel?: 'chat' | 'review' }
  ): Promise<boolean> {
    return false;
  }

  usesCompactionBeforeLoopRepeat(): boolean {
    return false;
  }
}

export function registerMockAgentService(app: AgentApp, path = MOCK_AGENT_SERVICE_PATH) {
  if (!isMockAgentServerEnabled()) return;
  const service = new MockAgentService();
  service.setup(app);
  app.use(path, service, {
    methods: [
      'handleMessageCreated',
      'handleTableMessageCreated',
      'stopSession',
      'stopTurn',
      'isEnabled',
      'listModels',
      'generateSessionMetadata',
      'isInterruptedSessionResumable',
    ],
  });
  registerAgentSdk(app, {
    key: MOCK_AGENT_SDK,
    label: MOCK_AGENT_SDK_LABEL,
    servicePath: path,
  });
}
