import logger from '../logger.js';
import { handleAppError } from '../lib/app-error-handler.js';
import { requireAgentConfigId } from '../lib/usage-snapshot.js';
import { requireTurnModelFromRow } from '../../shared/turn-model.js';
import type { MessageStreamWriter } from '../../shared/message-stream-writer.ts';
import type { SystemMessagePayload } from '../../shared/message-types.ts';
import { getSdkPlugin, registerAgentSdk } from '../agent-sdks/registry.js';
import {
  isDispatchableUserMessage,
  parseUserRow,
  rejectTurnMismatch,
} from './agent-message-dispatch.js';
import {
  prepareAgentTurnCompaction,
  registerBaguetteToolMessageCompactionHook,
  unregisterBaguetteToolMessageCompactionHook,
} from './agent-turn-compaction.js';
import {
  clearAgentActiveTurnId,
  setAgentActiveTurnId,
  setAgentTurnRunning,
  setAgentTurnTerminal,
} from './agent-turn-patch.js';
import { assertAgentTurnCredentials, prepareAgentTurnStart } from './agent-turn-prelude.js';
import {
  builderChatActiveKey,
  getAgentById,
  getPrimaryBuilderAgent,
  getReviewerAgent,
  resolveAgentRowForMessage,
} from './agents-db.js';
import { disableExternal } from './feathers/hooks.js';
import { sessionMessageIdentity } from './feathers/message-create-fields.js';
import { createMessageStreamWriter } from './message-writer-factory.ts';
import { getReviewAgentTurn, reviewTurnKey } from './review-agent-turn.js';
import { emptyTurnUsage } from './turn-usage.js';
import type {
  AgentApp,
  AgentRow,
  AgentSessionRow,
  DbLike,
  MessageChannel,
  MessageRowLike,
} from './feathers/agent-service-types.ts';

export type StoredSessionIdColumn =
  'claude_session_id' | 'cursor_agent_id' | 'pi_session_id' | 'antigravity_session_id';

export type TurnModelContext = {
  model: string | null;
  modelParams: unknown;
};

export type IncomingUserMessageContext<TActive = unknown> = {
  session: AgentSessionRow;
  agent: AgentRow;
  parsed: unknown;
  row: MessageRowLike;
  channel: MessageChannel;
  isReview: boolean;
  activeKey: string | number;
  active?: TActive;
};

export type HandleAgentMessageCreatedOptions<TActive = unknown> = {
  app: AgentApp;
  row: MessageRowLike;
  expectedSdk: string;
  handlingMessageIds?: Set<number>;
  loadSession?: (sessionId: number) => Promise<AgentSessionRow | null | undefined>;
  getActiveTurn: (activeKey: string | number) => TActive | undefined;
  isActiveProcessing?: (active: TActive) => boolean;
  onActiveTurnMessage?: (ctx: IncomingUserMessageContext<TActive>) => Promise<void> | void;
  onStartTurn: (ctx: IncomingUserMessageContext<TActive>) => Promise<void> | void;
};

/**
 * Shared `handleMessageCreated` pipeline for every agent SDK service:
 * deduplicates concurrent delivery of the same message row, validates the
 * session/agent/SDK/channel, rejects mismatched turn IDs on active turns, and
 * delegates either to `onActiveTurnMessage` (steering/injection) or `onStartTurn`.
 */
export async function handleAgentMessageCreated<TActive = unknown>(
  opts: HandleAgentMessageCreatedOptions<TActive>
): Promise<void> {
  const { row, handlingMessageIds } = opts;
  if (row.type !== 'user') return;
  if (handlingMessageIds && row.id != null) {
    if (handlingMessageIds.has(row.id)) return;
    handlingMessageIds.add(row.id);
  }
  try {
    await handleAgentMessageCreatedImpl(opts);
  } finally {
    if (handlingMessageIds && row.id != null) {
      handlingMessageIds.delete(row.id);
    }
  }
}

async function handleAgentMessageCreatedImpl<TActive>(
  opts: HandleAgentMessageCreatedOptions<TActive>
): Promise<void> {
  const {
    app,
    row,
    expectedSdk,
    loadSession,
    getActiveTurn,
    isActiveProcessing,
    onActiveTurnMessage,
    onStartTurn,
  } = opts;

  const parsed = parseUserRow(row);
  if (!parsed || !isDispatchableUserMessage(parsed)) return;

  const db = app.get('db') as DbLike;
  const sessionId = row.session_id;
  const session = loadSession
    ? await loadSession(sessionId)
    : ((await db('sessions').where({ id: sessionId }).first()) as AgentSessionRow | undefined);
  if (!session || session.archived_at) return;

  const agent = (await resolveAgentRowForMessage(db as never, row as never)) as
    AgentRow | undefined;
  if (!agent) return;

  const isReview = agent.agent_type === 'reviewer';
  const channel: MessageChannel = isReview ? 'review' : 'chat';
  const sdk = row.agent_sdk ?? agent.agent_sdk;
  if (sdk !== expectedSdk) return;

  if (!isReview) {
    if (session.status === 'archiving' || session.status === 'archived') return;
    if (session.repo_full_name && !session.session_path) return;
  }

  const activeKey = isReview ? reviewTurnKey(agent.id) : builderChatActiveKey(agent);
  const active = getActiveTurn(activeKey);
  const processing =
    active !== undefined && (isActiveProcessing ? isActiveProcessing(active) : Boolean(active));

  const ctx: IncomingUserMessageContext<TActive> = {
    session,
    agent,
    parsed,
    row,
    channel,
    isReview,
    activeKey,
    active,
  };

  if (processing) {
    const activeTurnId = agent.active_turn_id;
    if (row.turn_id != null && activeTurnId != null && row.turn_id !== activeTurnId) {
      await rejectTurnMismatch(app, {
        session,
        row,
        channel,
        activeTurnId,
        userId: session.user_id,
      });
      return;
    }
    if (onActiveTurnMessage) {
      await onActiveTurnMessage(ctx);
    }
    return;
  }

  await onStartTurn(ctx);
}

/**
 * Persist a `system/status` message attributed to the session's reviewer,
 * specific builder agent, or primary builder agent.
 */
export async function persistAgentStatusMessage(
  app: AgentApp,
  opts: {
    sessionId: number;
    userId: number;
    statusText: string;
    agentSdk: string;
    channel?: MessageChannel;
    builderAgentId?: number | null;
    turnId?: number | null;
  }
): Promise<void> {
  const {
    sessionId,
    userId,
    statusText,
    agentSdk,
    channel = 'chat',
    builderAgentId,
    turnId,
  } = opts;
  const db = app.get('db');
  let agentRow: AgentRow | undefined;
  if (channel === 'review') {
    agentRow = (await getReviewerAgent(db, sessionId)) as AgentRow | undefined;
  } else if (builderAgentId != null) {
    agentRow = (await getAgentById(db, builderAgentId)) as AgentRow | undefined;
  } else {
    agentRow = (await getPrimaryBuilderAgent(db, sessionId)) as AgentRow | undefined;
  }
  if (!agentRow) return;

  const payload: SystemMessagePayload = { type: 'system', subtype: 'status', status: statusText };
  await app.service('messages').create(
    {
      session_id: sessionId,
      ...(turnId != null ? { turn_id: turnId } : {}),
      type: 'system',
      subtype: 'status',
      message_json: JSON.stringify(payload),
      ...sessionMessageIdentity(agentRow, {
        agent_sdk: agentSdk,
      }),
    },
    { provider: undefined, user: { id: userId } }
  );
}

/**
 * Shared `isInterruptedSessionResumable` check: resolves the target agent row
 * (reviewer or primary builder when omitted) and checks its SDK session column.
 */
export async function isAgentSessionResumable(
  app: AgentApp,
  session: AgentSessionRow,
  storedSessionIdColumn: StoredSessionIdColumn,
  opts: { channel?: MessageChannel; agent?: AgentRow } = {}
): Promise<boolean> {
  const { channel = 'chat', agent: agentRow } = opts;
  let agent = agentRow;
  if (!agent) {
    const db = app.get('db');
    agent =
      channel === 'review'
        ? ((await getReviewerAgent(db, session.id)) as AgentRow | undefined)
        : ((await getPrimaryBuilderAgent(db, session.id)) as AgentRow | undefined);
  }
  return Boolean(agent?.[storedSessionIdColumn]);
}

export type BaseTurnSessionState = {
  isProcessing: boolean;
  userId: number;
  agentId: number;
  writer: MessageStreamWriter | null;
  turnId: number | null;
  channel: MessageChannel;
  turnAgentConfigId: number | null;
  endTurnAwaitingUser?: boolean;
};

export type AgentTurnExecutionContext<TState extends BaseTurnSessionState> = {
  session: AgentSessionRow;
  agent: AgentRow;
  row: MessageRowLike;
  channel: MessageChannel;
  activeKey: string | number;
  turnId: number | null;
  turnModel: TurnModelContext;
  turnAgentConfigId: number | null;
  writer: MessageStreamWriter | null;
  sessionState: TState;
};

export type AgentTurnExecutionResult<TUsage = unknown> = {
  outcome: 'completed' | 'failed' | 'stopped' | 'none';
  turnUsage?: TUsage | null;
  error_message?: string | null;
  reviewExtra?: Record<string, unknown>;
};

export type RunAgentTurnLifecycleOptions<TState extends BaseTurnSessionState, TUsage = unknown> = {
  app: AgentApp;
  sdk: string;
  logPrefix: string;
  streamErrorLabel: string;
  session: AgentSessionRow;
  row: MessageRowLike;
  meta: {
    turnId?: number | null;
    channel?: MessageChannel;
    activeKey?: string | number;
    agent?: AgentRow;
  };
  activeSessions: Map<string | number, TState>;
  createSessionState: (init: {
    userId: number;
    agentId: number;
    turnId: number | null;
    channel: MessageChannel;
  }) => TState;
  registerCompactionHook?: boolean;
  emitAppErrorEvenWithWriter?: boolean;
  execute: (ctx: AgentTurnExecutionContext<TState>) => Promise<AgentTurnExecutionResult<TUsage>>;
  recordTurnUsage: (
    usage: TUsage,
    opts: {
      turnModel: TurnModelContext;
      patchSessionCost: boolean;
      agentConfigId: number | null;
      agentId: number;
    }
  ) => Promise<void>;
  recordTurnError?: (
    writer: MessageStreamWriter | null | undefined,
    message: string
  ) => Promise<void>;
  onError?: (
    err: unknown,
    ctx: {
      session: AgentSessionRow;
      agent: AgentRow;
      userId: number;
      channel: MessageChannel;
      sessionState: TState;
    }
  ) => Promise<boolean>;
};

/**
 * Shared outer turn lifecycle for per-turn agent SDK services (Antigravity, Pi,
 * Cursor): tracks active turn state, prepares turn start + stream writer,
 * delegates SDK execution, records usage and terminal status, handles errors
 * and cleanup, and triggers queued follow-up turns on completion.
 */
export async function runAgentTurnLifecycle<TState extends BaseTurnSessionState, TUsage = unknown>(
  opts: RunAgentTurnLifecycleOptions<TState, TUsage>
): Promise<void> {
  const {
    app,
    sdk,
    logPrefix,
    streamErrorLabel,
    session,
    row,
    meta,
    activeSessions,
    createSessionState,
    registerCompactionHook = false,
    emitAppErrorEvenWithWriter = false,
    execute,
    recordTurnUsage,
    recordTurnError,
    onError,
  } = opts;

  const sessionId = session.id;
  const userId = session.user_id;
  const channel: MessageChannel = meta.channel ?? 'chat';
  const activeKey = meta.activeKey ?? sessionId;
  const turnId = meta.turnId ?? null;
  const agent = meta.agent;
  if (!agent) return;

  let turnFinishedOk = false;

  if (turnId != null) {
    await setAgentActiveTurnId(app, agent, userId, turnId);
  }

  const sessionState = createSessionState({
    userId,
    agentId: agent.id,
    turnId,
    channel,
  });
  activeSessions.set(activeKey, sessionState);

  let writer: MessageStreamWriter | null = null;
  let awaitingUser = false;
  try {
    const turnModel = requireTurnModelFromRow(row, {
      sdk,
      requiresModelParamsOnTurn: getSdkPlugin(sdk)?.requiresModelParamsOnTurn === true,
    }) as TurnModelContext;
    const turnAgentConfigId = requireAgentConfigId(row.agent_config_id) as number | null;

    await assertAgentTurnCredentials(app, {
      userId,
      agentSdk: sdk,
      agentConfigId: turnAgentConfigId,
    });

    await prepareAgentTurnStart(app, session, agent, {
      channel,
      agentSdk: sdk,
    });

    if (registerCompactionHook) {
      registerBaguetteToolMessageCompactionHook(sessionId, () =>
        prepareAgentTurnCompaction(app, session)
      );
    }

    writer =
      turnId != null
        ? createMessageStreamWriter(app, {
            sessionId,
            userId,
            turnId,
            agentId: agent.id,
            channel,
            sessionPath: session.session_path,
            agentType: sdk,
            model: turnModel.model ?? '',
            modelParams: turnModel.modelParams,
            agentConfigId: turnAgentConfigId,
          })
        : null;
    sessionState.writer = writer;
    sessionState.turnAgentConfigId = turnAgentConfigId;

    if (channel !== 'review') {
      await setAgentTurnRunning(app, agent, userId);
      await app.service('sessions').onTurnStart(sessionId);
    }

    const result = await execute({
      session,
      agent,
      row,
      channel,
      activeKey,
      turnId,
      turnModel,
      turnAgentConfigId,
      writer,
      sessionState,
    });

    const { outcome, turnUsage, error_message, reviewExtra } = result;
    awaitingUser = Boolean(sessionState.endTurnAwaitingUser);

    if (outcome === 'completed') {
      turnFinishedOk = true;
      await recordTurnUsage((turnUsage ?? emptyTurnUsage()) as TUsage, {
        turnModel,
        patchSessionCost: true,
        agentConfigId: sessionState.turnAgentConfigId,
        agentId: agent.id,
      }).catch((err: Error) =>
        logger.warn({ sessionId, err: err.message }, `${logPrefix}: failed to record turn usage`)
      );
      if (!awaitingUser) {
        if (channel === 'review') {
          await getReviewAgentTurn(app).onAgentTurnComplete(session, 'completed', {
            sdk,
            turnModel,
            turnUsage,
            ...reviewExtra,
          });
        } else {
          await setAgentTurnTerminal(app, agent, userId, 'completed');
        }
      }
    } else if (outcome === 'failed') {
      turnFinishedOk = awaitingUser;
      if (channel === 'review') {
        await getReviewAgentTurn(app).onAgentTurnComplete(session, 'failed', {
          sdk,
          error_message,
        });
      } else if (!awaitingUser) {
        await setAgentTurnTerminal(app, agent, userId, 'failed', { error_message });
      }
    } else if (outcome === 'stopped') {
      turnFinishedOk = awaitingUser;
      if (channel !== 'review') {
        await setAgentTurnTerminal(app, agent, userId, 'stopped');
      }
    }
  } catch (err) {
    awaitingUser = Boolean(sessionState.endTurnAwaitingUser);
    const handled = onError
      ? await onError(err, { session, agent, userId, channel, sessionState })
      : false;
    if (!handled) {
      if ((err as Error).name !== 'AbortError') {
        handleAppError(app, err, { userId, sessionId });
        logger.error(
          { sessionId, err: (err as Error).message },
          `${streamErrorLabel} session stream error`
        );
        try {
          if (channel === 'review') {
            await getReviewAgentTurn(app).onAgentTurnComplete(session, 'failed', {
              sdk,
              error_message: (err as Error).message,
            });
          } else {
            if (writer && recordTurnError) {
              await recordTurnError(writer, (err as Error).message);
            }
            await setAgentTurnTerminal(app, agent, userId, 'failed', {
              error_message: (err as Error).message,
            });
            if (!writer && !emitAppErrorEvenWithWriter) {
              app.service('sessions').emit('app:error', {
                sessionId,
                message: (err as Error).message,
                user_id: userId,
              });
            }
          }
        } catch {
          // ignore secondary errors
        }
        if (emitAppErrorEvenWithWriter) {
          app.service('sessions').emit('app:error', {
            sessionId,
            message: (err as Error).message,
            user_id: userId,
          });
        }
      } else if (awaitingUser) {
        turnFinishedOk = true;
      }
    }
  } finally {
    if (registerCompactionHook) {
      unregisterBaguetteToolMessageCompactionHook(sessionId);
    }
    await clearAgentActiveTurnId(app, agent, userId).catch(() => {});
    activeSessions.delete(activeKey);
  }

  if (turnFinishedOk && channel !== 'review') {
    try {
      await app.service('sessions').onTurnComplete(sessionId, agent.id);
    } catch (err) {
      logger.warn(
        { sessionId, err: (err as Error).message },
        `${logPrefix}: failed to send queued message`
      );
    }
  }
}

/**
 * Mount an internal-only agent SDK Feathers service (protected by
 * `disableExternal`) and register it in the agent SDK registry.
 */
export function registerInternalAgentService<TService extends { setup(app: AgentApp): void }>(
  app: AgentApp,
  opts: {
    service: TService;
    path: string;
    methods: string[];
    key: string;
    label: string;
  }
): TService {
  const { service, path, methods, key, label } = opts;
  service.setup(app);
  app.use(path, service, { methods });
  // Internal-only service: drives the agent SDK and must never be reachable over the
  // HTTP transport (see PUBLIC_SERVICES for the declarative external allow-list).
  app.service(path).hooks({ before: { all: [disableExternal] } });
  registerAgentSdk(app, {
    key,
    label,
    servicePath: path,
  });
  return service;
}
