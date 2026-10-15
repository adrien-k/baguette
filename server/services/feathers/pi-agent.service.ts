import {
  type AgentSession as PiAgentSession,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
} from '@earendil-works/pi-coding-agent';
import { mkdir } from 'node:fs/promises';
import logger from '../../logger.js';
import { resolveDataDirRelativePath } from '../../config.js';
import { buildPiCustomTools } from '../baguette-mcp-server.js';
import { buildSystemPromptAppend } from '../session-prompt.js';
import { processPiSessionStream, type PiTurnUsage } from '../pi/pi-sdk-turn.ts';
import { piTurnResultOps } from '../pi/pi-mapping.ts';
import { emptyTurnUsage } from '../turn-usage.js';
import { extractUserTextFromUserPayload } from '../../../shared/user-message-content.js';
import { isSteerableUserMessage, requireTurnModelFromRow } from '../../../shared/turn-model.js';
import { attachAppErrorHandler, handleAppError } from '../../lib/app-error-handler.js';
import { createPiModelRuntime, resolvePiSessionModel } from '../pi-models.js';
import { loadOwnedAgentConfigDecrypted } from '../agent-context.js';
import { resolvePiCredentials } from '../pi/pi-config.js';
import { piAgentDir, piSessionsDir, piWorktreeCwd } from '../pi/pi-session-paths.js';
import { lunaroutePiAdditionalExtensionPaths } from '../pi/pi-lunaroute-extension-path.js';
import { getReviewAgentTurn, reviewTurnKey } from '../review-agent-turn.js';
import { coerceAgentConfigId, requireAgentConfigId } from '../../lib/usage-snapshot.js';
import {
  isDispatchableUserMessage,
  parseUserRow,
  rejectTurnMismatch,
} from '../agent-message-dispatch.js';
import { createMessageStreamWriter } from '../message-writer-factory.ts';
import { sessionMessageIdentity } from './message-create-fields.js';
import type { MessageStreamWriter } from '../../../shared/message-stream-writer.ts';
import type { SystemMessagePayload } from '../../../shared/session-messages.ts';
import type {
  AgentApp,
  AgentRow,
  AgentSessionRow,
  DbLike,
  MessageChannel,
  MessageRowLike,
  TiedSessionLoopCompactionArgs,
} from './agent-service-types.ts';
import { directPromptTiedSessionLoopCompaction } from './loop-compaction.ts';
import { PI_AGENT_SDK_KEY, PI_AGENT_SDK_LABEL, PI_AGENT_SERVICE_PATH } from '../agent-sdk-meta.js';
import { registerAgentSdk } from './agent-configs.service.js';
import {
  builderChatActiveKey,
  getAgentById,
  getPrimaryBuilderAgent,
  getReviewerAgent,
  resolveAgentRowForMessage,
} from '../agents-db.js';
import { patchAgentInternal } from './agents.service.js';
import {
  clearAgentActiveTurnId,
  setAgentActiveTurnId,
  setAgentTurnRunning,
  setAgentTurnTerminal,
} from '../agent-turn-patch.js';

const PI_METADATA_MODEL_ID = 'claude-haiku-4-5';
const METADATA_TIMEOUT_MS = 30_000;

type PiSessionState = {
  isProcessing: boolean;
  userId: number;
  agentId?: number;
  piSession: PiAgentSession | null;
  abortController?: AbortController;
  writer?: MessageStreamWriter | null;
  turnId?: number | null;
  channel?: MessageChannel;
  turnAgentConfigId?: number | null;
  endTurnAwaitingUser?: boolean;
};

export type PiBuildAgentOptionsResult = CreateAgentSessionOptions & {
  modelRuntime: Awaited<ReturnType<typeof createPiModelRuntime>>;
  pendingModelId?: string | null;
  pendingModelParams?: unknown;
  piApiKeyEnvVar?: string;
  piApiKey?: string | null;
  piAgentConfig?: Record<string, unknown> | null;
};

export class PiAgentService {
  app!: AgentApp;
  private _handlingMessageIds = new Set<number>();
  private _activeSessions = new Map<string | number, PiSessionState>();

  setup(app: AgentApp) {
    this.app = app;
  }

  async resolveCredentials(
    session: AgentSessionRow,
    _channel: MessageChannel = 'chat',
    agentConfigId?: number | null
  ) {
    const config = await this.loadAgentConfig(session.user_id, agentConfigId);
    return resolvePiCredentials(config);
  }

  /** Decrypted agent_configs row (null when no config id). */
  private async loadAgentConfig(userId: number, agentConfigId?: number | null) {
    const configId = coerceAgentConfigId(agentConfigId);
    return loadOwnedAgentConfigDecrypted(configId, userId, this.app.get('db') as DbLike as never);
  }

  async _buildAppendSystemPrompt(
    session: AgentSessionRow,
    agent?: AgentRow | null
  ): Promise<string[]> {
    if (!session.session_path) return [];
    const absoluteCwd = resolveDataDirRelativePath(session.session_path);
    const systemPrompt = await buildSystemPromptAppend(
      {
        ...session,
        absolute_session_path: absoluteCwd,
      },
      { agent }
    );
    return systemPrompt ? [systemPrompt] : [];
  }

  async _ensurePiDirs(session: AgentSessionRow): Promise<void> {
    const agentDir = piAgentDir(session);
    const sessionsDir = piSessionsDir(session);
    if (agentDir) await mkdir(agentDir, { recursive: true });
    if (sessionsDir) await mkdir(sessionsDir, { recursive: true });
  }

  _openSessionManager(session: AgentSessionRow, storedPiSessionId?: string | null): SessionManager {
    const cwd = piWorktreeCwd(session);
    const sessionsDir = piSessionsDir(session) ?? undefined;
    if (storedPiSessionId && sessionsDir) {
      const sessionFile = SessionManager.findById(cwd, storedPiSessionId, sessionsDir);
      if (sessionFile) {
        return SessionManager.open(sessionFile, sessionsDir, cwd);
      }
    }
    return SessionManager.create(cwd, sessionsDir);
  }

  async buildAgentOptions(
    session: AgentSessionRow,
    {
      model,
      modelParams,
      customTools,
      channel = 'chat',
      agentConfigId,
      storedPiSessionId,
      appendSystemPrompt,
      agent,
    }: {
      model?: string | null;
      modelParams?: unknown;
      customTools?: CreateAgentSessionOptions['customTools'];
      channel?: MessageChannel;
      /** The turn's agent config snapshot (from the message row). */
      agentConfigId?: number | null;
      storedPiSessionId?: string | null;
      appendSystemPrompt?: string[];
      agent?: AgentRow | null;
    } = {}
  ): Promise<PiBuildAgentOptionsResult> {
    await this._ensurePiDirs(session);
    const cwd = piWorktreeCwd(session);
    const agentDir = piAgentDir(session) ?? undefined;
    const configId = requireAgentConfigId(agentConfigId);
    const agentConfig = await this.loadAgentConfig(session.user_id, configId);
    const { apiKey, envVar } = resolvePiCredentials(agentConfig);
    if (!apiKey) {
      throw new Error('Pi API key is not configured for this session');
    }
    const modelRuntime = await createPiModelRuntime(apiKey, envVar);
    const modelId = model ?? null;
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const systemAppend =
      appendSystemPrompt ?? (await this._buildAppendSystemPrompt(session, agent));
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: agentDir ?? cwd,
      settingsManager,
      appendSystemPrompt: systemAppend,
      additionalExtensionPaths: lunaroutePiAdditionalExtensionPaths(envVar),
    });
    await resourceLoader.reload();
    const resolvedTools =
      customTools ?? (await buildPiCustomTools(session, this.app, { channel, agent }));
    const sessionManager = this._openSessionManager(session, storedPiSessionId);
    const options: PiBuildAgentOptionsResult = {
      cwd,
      agentDir,
      modelRuntime,
      model: undefined,
      thinkingLevel: undefined,
      pendingModelId: modelId,
      pendingModelParams: modelParams ?? null,
      piApiKeyEnvVar: envVar,
      piApiKey: apiKey,
      piAgentConfig: agentConfig,
      customTools: resolvedTools,
      resourceLoader,
      settingsManager,
      sessionManager,
    };
    return options;
  }

  async createOrResumePiSession(
    session: AgentSessionRow,
    opts: {
      agentOptions: PiBuildAgentOptionsResult;
      persistPiSessionId?: (piSessionId: string) => Promise<unknown> | unknown;
    }
  ): Promise<PiAgentSession> {
    const { session: piSession } = await createAgentSession(opts.agentOptions);
    const {
      pendingModelId,
      pendingModelParams,
      piApiKeyEnvVar,
      piApiKey,
      piAgentConfig,
      modelRuntime,
    } = opts.agentOptions;
    if (pendingModelId && modelRuntime) {
      await this._bindPiSessionModel(
        piSession,
        modelRuntime,
        pendingModelId,
        piApiKeyEnvVar ?? '',
        {
          apiKey: piApiKey,
          config: piAgentConfig,
          modelParams: pendingModelParams,
        }
      );
    }
    const piSessionId = piSession.sessionId;
    if (piSessionId) {
      await opts.persistPiSessionId?.(piSessionId);
    }
    return piSession;
  }

  async handleMessageCreated(row: MessageRowLike) {
    if (row.type !== 'user') return;
    if (row.id != null && this._handlingMessageIds.has(row.id)) return;
    if (row.id != null) this._handlingMessageIds.add(row.id);
    try {
      await this._handleMessageCreatedImpl(row);
    } finally {
      if (row.id != null) this._handlingMessageIds.delete(row.id);
    }
  }

  async _handleMessageCreatedImpl(row: MessageRowLike) {
    const parsed = parseUserRow(row);
    if (!parsed || !isDispatchableUserMessage(parsed)) return;

    const sessionId = row.session_id;
    const session = (await (this.app.get('db') as DbLike)('sessions')
      .where({ id: sessionId })
      .first()) as AgentSessionRow | undefined;
    if (!session || session.archived_at) return;

    const agent = (await resolveAgentRowForMessage(this.app.get('db') as never, row as never)) as
      AgentRow | undefined;
    if (!agent) return;

    const isReview = agent.agent_type === 'reviewer';
    const channel: MessageChannel = isReview ? 'review' : 'chat';
    const sdk = row.agent_sdk ?? agent.agent_sdk;
    if (sdk !== 'pi') return;

    if (!isReview) {
      if (session.status === 'archiving' || session.status === 'archived') return;
      if (session.repo_full_name && !session.session_path) return;
    }

    const activeKey = isReview ? reviewTurnKey(agent.id) : builderChatActiveKey(agent);
    const active = this._activeSessions.get(activeKey);
    const activeTurnId = agent.active_turn_id;

    if (active?.isProcessing) {
      if (row.turn_id != null && activeTurnId != null && row.turn_id !== activeTurnId) {
        await rejectTurnMismatch(this.app, {
          session,
          row,
          channel,
          activeTurnId,
          userId: session.user_id,
        });
        return;
      }
      if (row.force && active.piSession?.isStreaming && isSteerableUserMessage(parsed)) {
        const text = extractUserTextFromUserPayload(parsed);
        if (text) void active.piSession.steer(text).catch(() => {});
      }
      return;
    }

    const meta = {
      turnId: row.turn_id as number | null,
      channel,
      activeKey,
      agent,
    };
    attachAppErrorHandler(this.app, this._runTurn(session, parsed, row, meta), {
      userId: session.user_id,
      sessionId: session.id,
    }).catch((err) => {
      logger.error({ sessionId, err: (err as Error).message }, 'pi-agent turn failed');
    });
  }

  async runTurn({
    session,
    userText,
    agentOptions,
    writer,
    persistPiSessionId,
    persistStatus,
    activeKey,
    abortController,
    activeSessionState,
  }: {
    session: AgentSessionRow;
    userText: string;
    agentOptions: PiBuildAgentOptionsResult;
    writer: MessageStreamWriter;
    persistPiSessionId?: (piSessionId: string) => Promise<unknown> | unknown;
    persistStatus?: (text: string) => Promise<void>;
    activeKey?: string | number;
    abortController?: AbortController;
    /** When set, stream into this state; caller keeps `_activeSessions` until the turn ends. */
    activeSessionState?: PiSessionState;
  }): Promise<{
    outcome: 'completed' | 'failed' | 'stopped';
    turnUsage?: PiTurnUsage;
  }> {
    const key = activeKey ?? session.id;
    const controller = abortController ?? new AbortController();
    const ownsActiveSession = activeSessionState == null;
    const sessionState: PiSessionState = activeSessionState ?? {
      isProcessing: true,
      userId: session.user_id,
      piSession: null,
    };
    sessionState.abortController = controller;
    if (ownsActiveSession) {
      this._activeSessions.set(key, sessionState);
    }
    let outcome: 'completed' | 'failed' | 'stopped' = 'failed';
    let streamStarted = false;
    try {
      const piSession = await this.createOrResumePiSession(session, {
        agentOptions,
        persistPiSessionId,
      });
      sessionState.piSession = piSession;
      streamStarted = true;
      const { finishedOk, turnUsage } = await processPiSessionStream({
        writer,
        subscribe: (listener) =>
          piSession.subscribe((event) => {
            listener(event as Record<string, unknown>);
          }),
        runPrompt: async () => {
          await piSession.prompt(userText);
        },
        abortSignal: controller.signal,
      });
      outcome = finishedOk ? 'completed' : 'failed';
      return { outcome, turnUsage };
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        logger.error(
          { sessionId: session.id, err: (err as Error).message },
          'Pi session stream error'
        );
        try {
          if (!streamStarted) {
            await this._recordPiTurnError(writer, (err as Error).message);
          } else {
            await persistStatus?.((err as Error).message);
            this.app.service('sessions').emit('app:error', {
              sessionId: session.id,
              message: (err as Error).message,
              user_id: session.user_id,
            });
          }
        } catch {
          // ignore secondary errors
        }
        outcome = 'failed';
      } else {
        outcome = 'stopped';
      }
      return { outcome, turnUsage: emptyTurnUsage() };
    } finally {
      if (!streamStarted) {
        try {
          await writer.finish();
        } catch {
          // ignore writer cleanup errors
        }
      }
      if (ownsActiveSession) {
        this._activeSessions.delete(key);
      }
    }
  }

  async stopTurn(activeKey: string | number): Promise<void> {
    const session = this._activeSessions.get(activeKey);
    if (!session) return;
    try {
      session.abortController?.abort();
      await session.piSession?.abort();
    } catch {
      // ignore cancellation errors
    }
    this._activeSessions.delete(activeKey);
  }

  async _runTurn(
    session: AgentSessionRow,
    parsed: unknown,
    row: MessageRowLike,
    meta: {
      turnId?: number | null;
      channel?: MessageChannel;
      activeKey?: string | number;
      agent?: AgentRow;
    } = {}
  ): Promise<void> {
    const sessionId = session.id;
    const userId = session.user_id;
    const channel: MessageChannel = meta.channel ?? 'chat';
    const activeKey = meta.activeKey ?? sessionId;
    const turnId = meta.turnId ?? null;
    const agent = meta.agent;
    if (!agent) return;
    let turnFinishedOk = false;

    if (turnId != null) {
      await setAgentActiveTurnId(this.app, agent, userId, turnId);
    }

    const sessionState: PiSessionState = {
      isProcessing: true,
      userId,
      agentId: agent.id,
      piSession: null,
      writer: null,
      turnId,
      channel,
      turnAgentConfigId: null,
    };
    this._activeSessions.set(activeKey, sessionState);

    let writer: MessageStreamWriter | null = null;
    let awaitingUser = false;
    try {
      // Required turn context, resolved here so failures follow the turn's error path:
      // model and agent config come from the message row.
      const turnModel = requireTurnModelFromRow(row, { sdk: 'pi' });
      const turnAgentConfigId = requireAgentConfigId(row.agent_config_id);
      writer =
        turnId != null
          ? createMessageStreamWriter(this.app, {
              sessionId,
              userId,
              turnId,
              agentId: agent.id,
              channel,
              sessionPath: session.session_path,
              agentType: 'pi',
              model: turnModel.model ?? '',
              modelParams: turnModel.modelParams,
              agentConfigId: turnAgentConfigId,
            })
          : null;
      sessionState.writer = writer;
      sessionState.turnAgentConfigId = turnAgentConfigId;
      if (channel !== 'review') {
        await setAgentTurnRunning(this.app, agent, userId);
        await this.app.service('sessions').onTurnStart(sessionId);
      }

      const storedPiSessionId = agent.pi_session_id;
      const model = turnModel.model;

      const reviewExtras =
        channel === 'review'
          ? (getReviewAgentTurn(this.app).peekTurnExtras(sessionId) ?? {})
          : null;
      const agentOptions =
        channel === 'review'
          ? await getReviewAgentTurn(this.app).buildPiReviewAgentOptions(session, agent, {
              model,
              modelParams: turnModel.modelParams,
              agentConfigId: turnAgentConfigId,
              continuation: !!storedPiSessionId || Boolean(reviewExtras?.continuation),
              extraPrompt: reviewExtras?.extraPrompt,
            })
          : await this.buildAgentOptions(session, {
              model,
              modelParams: turnModel.modelParams,
              channel,
              agentConfigId: turnAgentConfigId,
              storedPiSessionId: storedPiSessionId as string | null | undefined,
              agent,
            });

      const userText = extractUserTextFromUserPayload(parsed);
      if (!writer) {
        throw new Error('pi-agent: missing turn writer');
      }

      const { outcome, turnUsage } = await this.runTurn({
        session,
        userText,
        agentOptions,
        writer,
        activeKey,
        activeSessionState: sessionState,
        persistPiSessionId: (piSessionId) =>
          patchAgentInternal(this.app, agent.id, { pi_session_id: piSessionId }, userId),
        persistStatus: async (text) => {
          await this._persistStatusMessage(sessionId, userId, text, session, channel, agent.id);
        },
      });

      awaitingUser = Boolean(sessionState.endTurnAwaitingUser);
      turnFinishedOk = outcome === 'completed' || awaitingUser;
      if (outcome === 'completed') {
        await this.app
          .service('sessions')
          .recordPiUsage(session, turnUsage ?? emptyTurnUsage(), {
            turnModel,
            patchSessionCost: true,
            agentConfigId: sessionState.turnAgentConfigId,
            agentId: agent.id,
          })
          .catch((err: Error) =>
            logger.warn({ sessionId, err: err.message }, 'pi-agent: failed to record turn usage')
          );
        if (!awaitingUser) {
          if (channel === 'review') {
            await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'completed', {
              sdk: 'pi',
              turnModel,
              turnUsage,
            });
          } else {
            await setAgentTurnTerminal(this.app, agent, userId, 'completed');
          }
        }
      } else if (outcome === 'failed' && channel === 'review') {
        await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'failed', {
          sdk: 'pi',
        });
      } else if (outcome === 'failed' && channel !== 'review' && !awaitingUser) {
        await setAgentTurnTerminal(this.app, agent, userId, 'failed');
      }
    } catch (err) {
      awaitingUser = Boolean(sessionState.endTurnAwaitingUser);
      if ((err as Error).name !== 'AbortError') {
        handleAppError(this.app, err, { userId, sessionId });
        logger.error({ sessionId, err: (err as Error).message }, 'Pi session stream error');
        try {
          if (channel === 'review') {
            await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'failed', {
              sdk: 'pi',
            });
            await getReviewAgentTurn(this.app)._persistStatus(session, (err as Error).message);
          } else {
            await setAgentTurnTerminal(this.app, agent, userId, 'failed');
            if (writer) {
              await this._recordPiTurnError(writer, (err as Error).message);
            } else {
              await this._persistStatusMessage(
                sessionId,
                userId,
                (err as Error).message,
                session,
                channel,
                agent.id
              );
              this.app.service('sessions').emit('app:error', {
                sessionId,
                message: (err as Error).message,
                user_id: userId,
              });
            }
          }
        } catch {
          // ignore secondary errors
        }
      } else if (awaitingUser) {
        turnFinishedOk = true;
      }
    } finally {
      await clearAgentActiveTurnId(this.app, agent, userId).catch(() => {});
      this._activeSessions.delete(activeKey);
    }

    if (turnFinishedOk && channel !== 'review') {
      try {
        await this.app.service('sessions').onTurnComplete(sessionId, agent.id);
      } catch (err) {
        logger.warn(
          { sessionId, err: (err as Error).message },
          'pi-agent: failed to send queued message'
        );
      }
    }
  }

  async _bindPiSessionModel(
    piSession: PiAgentSession,
    modelRuntime: Awaited<ReturnType<typeof createPiModelRuntime>>,
    modelId: string,
    envVar: string,
    options: {
      apiKey?: string | null;
      config?: Record<string, unknown> | null;
      modelParams?: unknown;
    } = {}
  ) {
    const resolved = await resolvePiSessionModel(
      modelRuntime,
      modelId,
      envVar,
      {
        apiKey: options.apiKey,
        config: options.config,
      },
      options.modelParams ?? null
    );
    if (resolved.error || !resolved.model) {
      throw new Error(resolved.error ?? `Could not resolve Pi model "${modelId}"`);
    }
    await piSession.setModel(resolved.model, { thinkingLevel: resolved.thinkingLevel });
  }

  async _recordPiTurnError(writer: MessageStreamWriter | null | undefined, message: string) {
    const text = String(message ?? '').trim();
    if (!writer || !text) return;
    await writer.apply(piTurnResultOps('error', text));
  }

  async _persistStatusMessage(
    sessionId: number,
    userId: number,
    statusText: string,
    _session: AgentSessionRow,
    channel: MessageChannel = 'chat',
    builderAgentId?: number | null
  ) {
    const db = this.app.get('db');
    let agentRow;
    if (channel === 'review') {
      agentRow = await getReviewerAgent(db, sessionId);
    } else if (builderAgentId != null) {
      agentRow = await getAgentById(db, builderAgentId);
    } else {
      agentRow = await getPrimaryBuilderAgent(db, sessionId);
    }
    if (!agentRow) return;
    const payload: SystemMessagePayload = { type: 'system', subtype: 'status', status: statusText };
    await this.app.service('messages').create(
      {
        session_id: sessionId,
        type: 'system',
        subtype: 'status',
        message_json: JSON.stringify(payload),
        ...sessionMessageIdentity(agentRow, {
          agent_sdk: 'pi',
        }),
      },
      { provider: undefined, user: { id: userId } }
    );
  }

  async stopSession(sessionId: number) {
    await this.stopTurn(sessionId);
    await this.stopTurn(reviewTurnKey(sessionId));
  }

  getActiveSession(sessionId: string | number): PiSessionState | null {
    return this._activeSessions.get(sessionId) ?? null;
  }

  async get(id: number) {
    return this.getActiveSession(id);
  }

  async generateSessionMetadata(
    initialPrompt: string,
    shortId = '',
    user: { id?: number } | null = null,
    _repo: { id?: number | null } | null = null,
    session: Pick<AgentSessionRow, 'model' | 'model_params' | 'agent_config_id'> | null = null
  ): Promise<{ label: string; branchName: string }> {
    const fallbackBranch = `task-${shortId}`;
    const prompt = `Generate metadata for a coding task. Output ONLY a JSON object with no markdown or explanation:
- "label": very short label (max 50 chars) summarizing the task
- "branch": short kebab-case git branch name suffixed with "-${shortId}" (e.g. "fix-auth-token-${shortId}"), max 60 chars

Task: ${initialPrompt}`;

    let label = '';
    let branchName = fallbackBranch;

    const config = user?.id ? await this.loadAgentConfig(user.id, session?.agent_config_id) : null;
    const { apiKey, envVar } = resolvePiCredentials(config);
    if (!apiKey) {
      return { label, branchName };
    }

    const modelRuntime = await createPiModelRuntime(apiKey, envVar);
    const modelId = session?.model || PI_METADATA_MODEL_ID;

    const cwd = process.cwd();
    const agentDir = undefined;
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: cwd,
      settingsManager,
      additionalExtensionPaths: lunaroutePiAdditionalExtensionPaths(envVar),
    });
    await resourceLoader.reload();
    const sessionManager = SessionManager.inMemory(cwd);
    const { session: piSession } = await createAgentSession({
      cwd,
      modelRuntime,
      model: undefined,
      resourceLoader,
      settingsManager,
      sessionManager,
      customTools: [],
    });

    try {
      await this._bindPiSessionModel(piSession, modelRuntime, modelId, envVar, {
        apiKey,
        config,
      });
    } catch {
      return { label, branchName };
    }

    let collectedText = '';
    const unsubscribe = piSession.subscribe((event) => {
      if (event.type === 'message_update') {
        const inner = (event as { assistantMessageEvent?: { type?: string; delta?: string } })
          .assistantMessageEvent;
        if (inner?.type === 'text_delta' && typeof inner.delta === 'string') {
          collectedText += inner.delta;
        }
      }
    });

    const consume = (async () => {
      await piSession.prompt(prompt);
    })();

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        consume,
        new Promise<void>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Metadata generation timed out')),
            METADATA_TIMEOUT_MS
          );
        }),
      ]);
    } catch {
      // fall back to defaults
    } finally {
      if (timer) clearTimeout(timer);
      unsubscribe();
      try {
        await piSession.abort();
      } catch {
        // ignore
      }
    }

    const text = collectedText.trim();
    if (text) {
      try {
        const jsonText = text
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '')
          .trim();
        const parsed = JSON.parse(jsonText) as { label?: string; branch?: string };
        label = (parsed.label || '').slice(0, 80);
        branchName = (parsed.branch || fallbackBranch)
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .slice(0, 60);
      } catch {
        label = text.slice(0, 80);
      }
    }

    return { label, branchName };
  }

  /**
   * TODO: run loop compaction through a Pi plugin when one supports it; until then, re-send the prompt only.
   */
  async prepareTiedSessionLoopCompaction(args: TiedSessionLoopCompactionArgs): Promise<void> {
    await directPromptTiedSessionLoopCompaction(this.app, args);
  }

  async isInterruptedSessionResumable(
    session: AgentSessionRow,
    { channel = 'chat', agent: agentRow }: { channel?: MessageChannel; agent?: AgentRow } = {}
  ): Promise<boolean> {
    let agent = agentRow;
    if (!agent) {
      agent =
        channel === 'review'
          ? ((await getReviewerAgent(this.app.get('db'), session.id)) as AgentRow | undefined)
          : ((await getPrimaryBuilderAgent(this.app.get('db'), session.id)) as
              AgentRow | undefined);
    }
    return Boolean(agent?.pi_session_id);
  }
}

export function registerPiAgentService(app: AgentApp, path = PI_AGENT_SERVICE_PATH) {
  const service = new PiAgentService();
  service.setup(app);
  app.use(path, service, {
    methods: [
      'stopSession',
      'stopTurn',
      'runTurn',
      'buildAgentOptions',
      'generateSessionMetadata',
      'prepareTiedSessionLoopCompaction',
      'handleMessageCreated',
      'isInterruptedSessionResumable',
    ],
  });
  registerAgentSdk(app, {
    key: PI_AGENT_SDK_KEY,
    label: PI_AGENT_SDK_LABEL,
    servicePath: path,
  });
}
