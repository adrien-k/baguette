import logger from '../../logger.js';
import { attachAppErrorHandler, handleAppError } from '../../lib/app-error-handler.js';
import { createMessageStreamWriter } from '../../services/message-writer-factory.ts';
import { requireTurnModelFromRow } from '../../../shared/turn-model.js';
import { isMockAgentSdkEnabled, mockUserPromptText } from '../../../shared/mock-agent-sdk.js';
import { MOCK_AGENT_SDK, MOCK_AGENT_SDK_LABEL, MOCK_AGENT_SERVICE_PATH } from './meta.js';
import {
  handleAgentMessageCreated,
  registerInternalAgentService,
} from '../../services/agent-service-lifecycle.ts';
import { getSdkPlugin, registerSdkPlugin } from '../registry.js';
import { claudeBuildToolCallStart, claudeBuildToolCallComplete } from '../claude/mapping.ts';
import { requireAgentConfigId } from '../../lib/usage-snapshot.js';
import { runMockAgentTurn, runMockReviewerTurn } from './mock-agent-turn.js';
import { recordMockTurnUsage } from './record-turn-usage.js';
import { getReviewAgentTurn } from '../../services/review-agent-turn.js';
import { issueAgentMetadataFromTurn } from '../../services/session-issues.js';
import {
  clearAgentActiveTurnId,
  setAgentActiveTurnId,
  setAgentTurnRunning,
  setAgentTurnTerminal,
} from '../../services/agent-turn-patch.js';
import { prepareAgentTurnStart } from '../../services/agent-turn-prelude.js';
import type {
  AgentApp,
  AgentRow,
  AgentSessionRow,
  ChatTable,
  MessageChannel,
  MessageRowLike,
} from '../../services/feathers/agent-service-types.ts';

type MockSessionState = {
  userId: number;
  agentId?: number;
  abortController: AbortController;
  turnId?: number | null;
  channel?: MessageChannel;
  endTurnAwaitingUser?: boolean;
};

class MockAgentService {
  app!: AgentApp;
  private _activeSessions = new Map<string | number, MockSessionState>();

  setup(app: AgentApp) {
    this.app = app;
  }

  async handleTableMessageCreated(row: MessageRowLike, _table: ChatTable) {
    if (!isMockAgentSdkEnabled()) return;
    await handleAgentMessageCreated({
      app: this.app,
      row,
      expectedSdk: MOCK_AGENT_SDK,
      getActiveTurn: (key) => this._activeSessions.get(key),
      onStartTurn: ({ session, agent, parsed, channel, activeKey }) => {
        const userPrompt = mockUserPromptText(parsed);
        const turnModel = requireTurnModelFromRow(row, {
          sdk: MOCK_AGENT_SDK,
          requiresModelParamsOnTurn:
            getSdkPlugin(MOCK_AGENT_SDK)?.requiresModelParamsOnTurn === true,
        });
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
          { userId: session.user_id, sessionId: session.id }
        ).catch((err) => {
          logger.error(
            { sessionId: session.id, err: (err as Error).message },
            'mock-agent turn failed'
          );
        });
      },
    });
  }

  getActiveSession(sessionOrId: string | number): MockSessionState | undefined {
    return this._activeSessions.get(sessionOrId);
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
    const sessionState: MockSessionState = {
      userId,
      agentId: agent.id,
      abortController,
      turnId,
      channel,
    };
    this._activeSessions.set(activeKey, sessionState);

    const isReview = channel === 'review';
    let turnFinishedOk = false;
    try {
      await prepareAgentTurnStart(this.app, session, agent, {
        channel,
        agentSdk: MOCK_AGENT_SDK,
      });
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
          agent,
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
            error_message: (err as Error).message,
          });
        } else {
          await setAgentTurnTerminal(this.app, agent, userId, 'failed', {
            error_message: (err as Error).message,
          });
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

    if (turnFinishedOk) {
      await this.recordTurnUsage(session, {
        turnModel,
        patchSessionCost: true,
        agentConfigId: meta.turnAgentConfigId,
        agentId: agent.id,
      }).catch((err: Error) =>
        logger.warn(
          { sessionId, err: (err as Error).message },
          'mock-agent: failed to record turn usage'
        )
      );
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

  /**
   * One completed mock turn: fixed fake tokens + fixed fake USD cost, recorded
   * like the real SDKs so usage UIs (sidebar cost tooltip, Usage page) light up.
   */
  async recordTurnUsage(
    session: AgentSessionRow,
    opts: {
      turnModel?: { model?: string | null; modelParams?: unknown };
      patchSessionCost?: boolean;
      agentConfigId?: number | null;
      agentId?: number;
    } = {}
  ): Promise<number> {
    return recordMockTurnUsage(this.app, session, opts);
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

  /**
   * One-shot completion primitive (shared contract — see services/session-metadata.js).
   * The mock SDK has no model to run: an empty string makes callers fall back to
   * their default label and `task-<shortId>` branch.
   */
  async completeText(_prompt: string, _opts?: Record<string, unknown>): Promise<string> {
    return '';
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
  // Tests may mount this service without the SDK manifest; keep the module
  // registry in sync so message writers find mock tool-call builders.
  registerSdkPlugin({
    key: MOCK_AGENT_SDK,
    label: MOCK_AGENT_SDK_LABEL,
    servicePath: path,
    requiresApiKey: false,
    ownerOnlySystemAuth: false,
    supportsModelParams: false,
    storedSessionIdColumn: null,
    toolCallBuilders() {
      return {
        buildToolCallStart: claudeBuildToolCallStart,
        buildToolCallComplete: claudeBuildToolCallComplete,
      };
    },
  });
  registerInternalAgentService(app, {
    service: new MockAgentService(),
    path,
    methods: [
      'handleMessageCreated',
      'handleTableMessageCreated',
      'stopSession',
      'stopTurn',
      'completeText',
      'isInterruptedSessionResumable',
    ],
    key: MOCK_AGENT_SDK,
    label: MOCK_AGENT_SDK_LABEL,
  });
}
