import logger from '../../logger.js';
import { disableExternal } from './hooks.js';
import { attachAppErrorHandler, handleAppError } from '../../lib/app-error-handler.js';
import { createMessageStreamWriter } from '../message-writer-factory.ts';
import {
  isDispatchableUserMessage,
  parseUserRow,
  rejectTurnMismatch,
} from '../agent-message-dispatch.js';
import { requireTurnModelFromRow } from '../../../shared/turn-model.js';
import { isMockAgentSdkEnabled, mockUserPromptText } from '../../../shared/mock-agent-sdk.js';
import {
  MOCK_AGENT_SDK,
  MOCK_AGENT_SDK_LABEL,
  MOCK_AGENT_SERVICE_PATH,
} from '../agent-sdk-meta.js';
import { registerAgentSdk } from './agent-configs.service.js';
import { requireAgentConfigId } from '../../lib/usage-snapshot.js';
import { runMockAgentTurn, runMockReviewerTurn } from '../mock/mock-agent-turn.js';
import { getReviewAgentTurn, reviewTurnKey } from '../review-agent-turn.js';
import { issueAgentMetadataFromTurn } from '../session-issues.js';
import { builderChatActiveKey, resolveAgentRowForMessage } from '../agents-db.js';
import {
  clearAgentActiveTurnId,
  setAgentActiveTurnId,
  setAgentTurnRunning,
  setAgentTurnTerminal,
} from '../agent-turn-patch.js';
import type {
  AgentApp,
  AgentRow,
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

class MockAgentService {
  app!: AgentApp;
  private _activeSessions = new Map<string | number, MockSessionState>();

  setup(app: AgentApp) {
    this.app = app;
  }

  async handleTableMessageCreated(row: MessageRowLike, _table: ChatTable) {
    if (!isMockAgentSdkEnabled()) return;
    if (row.type !== 'user') return;

    const parsed = parseUserRow(row);
    if (!parsed || !isDispatchableUserMessage(parsed)) return;
    const userPrompt = mockUserPromptText(parsed);

    const sessionId = row.session_id;
    const db = this.app.get('db') as DbLike;
    const session = (await db('sessions').where({ id: sessionId }).first()) as
      AgentSessionRow | undefined;
    if (!session || session.archived_at) return;

    const agent = (await resolveAgentRowForMessage(db, row as never)) as AgentRow | undefined;
    if (!agent) return;

    const isReview = agent.agent_type === 'reviewer';
    const channel: MessageChannel = isReview ? 'review' : 'chat';
    const sdk = row.agent_sdk ?? agent.agent_sdk;
    if (sdk !== MOCK_AGENT_SDK) return;

    if (!isReview) {
      if (session.status === 'archiving' || session.status === 'archived') return;
      if (session.repo_full_name && !session.session_path) return;
    }

    const activeKey = isReview ? reviewTurnKey(agent.id) : builderChatActiveKey(agent);
    if (this._activeSessions.has(activeKey)) {
      const activeTurnId = agent.active_turn_id;
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

    const turnModel = requireTurnModelFromRow(row, { sdk: MOCK_AGENT_SDK });
    const turnAgentConfigId = requireAgentConfigId(row.agent_config_id);
    attachAppErrorHandler(
      this.app,
      this._runTurn(session, row, turnModel, {
        turnId: row.turn_id as number | null,
        channel,
        activeKey,
        turnAgentConfigId,
        agent,
        userPrompt,
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
    meta: {
      turnId?: number | null;
      channel?: MessageChannel;
      activeKey?: string | number;
      turnAgentConfigId?: number | null;
      agent?: AgentRow;
      userPrompt?: string;
    }
  ) {
    const sessionId = session.id;
    const userId = session.user_id;
    const channel: MessageChannel = meta.channel ?? 'chat';
    const activeKey = meta.activeKey ?? sessionId;
    const turnId = meta.turnId ?? null;
    const agent = meta.agent;
    if (!agent) return;

    if (turnId != null) {
      await setAgentActiveTurnId(this.app, agent, userId, turnId);
    }

    const model = turnModel.model ?? '';
    const writer =
      turnId != null
        ? createMessageStreamWriter(this.app, {
            sessionId,
            userId,
            turnId,
            agentId: agent.id,
            channel,
            sessionPath: session.session_path,
            agentType: 'mock',
            model,
            modelParams: turnModel.modelParams,
            agentConfigId: meta.turnAgentConfigId,
          })
        : null;
    if (!writer) {
      throw new Error('mock-agent requires a turn id');
    }

    const abortController = new AbortController();
    this._activeSessions.set(activeKey, {
      userId,
      agentId: agent.id,
      abortController,
      turnId,
      channel,
    });

    const isReview = channel === 'review';
    let turnFinishedOk = false;
    try {
      if (!isReview) {
        await setAgentTurnRunning(this.app, agent, userId);
        await this.app.service('sessions').onTurnStart(sessionId);
      }

      if (isReview) {
        const turnMeta = issueAgentMetadataFromTurn({
          agent_sdk: 'mock',
          model: turnModel.model ?? agent.model,
          model_params: turnModel.modelParams,
        });
        await runMockReviewerTurn({
          writer,
          abortSignal: abortController.signal,
          createIssue: (spec) =>
            this.app.service('session-issues').create(
              {
                session_id: sessionId,
                status: 'opened',
                severity: spec.severity,
                title: spec.title,
                description: spec.description,
                ...turnMeta,
              },
              { user: { id: userId } }
            ),
        });
      } else {
        const turnMeta = await runMockAgentTurn({
          session,
          writer,
          abortSignal: abortController.signal,
          userPrompt: meta.userPrompt ?? '',
          app: this.app,
          userId,
          turnId,
        });
        turnFinishedOk = true;
        const terminalStatus = turnMeta?.awaitingUser ? 'approval' : 'completed';
        await setAgentTurnTerminal(this.app, agent, userId, terminalStatus);
      }

      if (isReview) {
        turnFinishedOk = true;
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError' && (err as Error).message !== 'Aborted') {
        handleAppError(this.app, err as Error, { userId, sessionId });
        logger.error({ sessionId, err: (err as Error).message }, 'mock-agent stream error');
        if (isReview) {
          await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'failed', {
            sdk: MOCK_AGENT_SDK,
          });
        } else {
          await setAgentTurnTerminal(this.app, agent, userId, 'failed');
        }
        this.app.service('sessions').emit('app:error', {
          sessionId,
          message: (err as Error).message,
          user_id: userId,
        });
      }
    } finally {
      await clearAgentActiveTurnId(this.app, agent, userId).catch(() => {});
      this._activeSessions.delete(activeKey);
    }

    if (turnFinishedOk && isReview) {
      await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'completed', {
        sdk: MOCK_AGENT_SDK,
        turnModel,
      });
    } else if (turnFinishedOk && !isReview) {
      await this.app
        .service('sessions')
        .onTurnComplete(sessionId, agent.id)
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
  if (!isMockAgentSdkEnabled()) return;
  const service = new MockAgentService();
  service.setup(app);
  app.use(path, service, {
    methods: [
      'handleMessageCreated',
      'handleTableMessageCreated',
      'stopSession',
      'stopTurn',
      'generateSessionMetadata',
      'isInterruptedSessionResumable',
    ],
  });
  // Internal-only service: drives the agent SDK and must never be reachable over the
  // HTTP transport (see PUBLIC_SERVICES for the declarative external allow-list).
  app.service(path).hooks({ before: { all: [disableExternal] } });
  registerAgentSdk(app, {
    key: MOCK_AGENT_SDK,
    label: MOCK_AGENT_SDK_LABEL,
    servicePath: path,
  });
}
