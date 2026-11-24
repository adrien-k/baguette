import {
  type AgentSession as PiAgentSession,
  createAgentSession,
  createMcpExtension,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
} from '@earendil-works/pi-coding-agent';
import { mkdir } from 'node:fs/promises';
import {
  loadEnabledMcpServersForSession,
  readPiUserMcpConfig,
  writePiUserMcpConfig,
} from '../../services/user-mcp-runtime.js';
import logger from '../../logger.js';
import { resolveDataDirRelativePath } from '../../config.js';
import { buildBaguetteToolList, buildReviewerAgentTools } from '../../services/mcp/server.js';
import { loadConfiguredSlackApps } from '../../services/mcp/lib/slack.js';
import { toolListToPiCustomTools } from './adapt-tools.js';
import { createSpillOversizedToolResultsExtension } from './extensions/spill-oversized-tool-results.ts';
import { buildSystemPromptAppend } from '../../services/session-prompt.js';
import { processPiSessionStream, type PiTurnUsage } from './sdk-turn.ts';
import { piTurnResultOps } from './mapping.ts';
import { emptyTurnUsage } from '../../services/turn-usage.js';
import { extractUserTextFromUserPayload } from '../../../shared/user-message-content.js';
import { isSteerableUserMessage } from '../../../shared/turn-model.js';
import { attachAppErrorHandler } from '../../lib/app-error-handler.js';
import { createPiModelRuntime, resolvePiSessionModel } from './models.js';
import { loadOwnedAgentConfigDecrypted } from '../../services/agent-context.js';
import { resolvePiCredentials } from './config.js';
import { piAgentDir, piSessionsDir, piWorktreeCwd } from './session-paths.js';
import { lunaroutePiAdditionalExtensionPaths } from './lunaroute-extension-path.js';
import { getReviewAgentTurn, reviewTurnKey } from '../../services/review-agent-turn.js';
import { coerceAgentConfigId, requireAgentConfigId } from '../../lib/usage-snapshot.js';
import type { MessageStreamWriter } from '../../../shared/message-stream-writer.ts';
import type {
  AgentApp,
  AgentRow,
  AgentSessionRow,
  DbLike,
  MessageChannel,
  MessageRowLike,
  TiedSessionLoopCompactionArgs,
} from '../../services/feathers/agent-service-types.ts';
import { directPromptTiedSessionLoopCompaction } from '../../services/feathers/loop-compaction.ts';
import { PI_AGENT_SDK_KEY, PI_AGENT_SDK_LABEL, PI_AGENT_SERVICE_PATH } from './meta.js';
import { recordPiTurnUsage } from './record-turn-usage.js';
import {
  handleAgentMessageCreated,
  isAgentSessionResumable,
  persistAgentStatusMessage,
  registerInternalAgentService,
  runAgentTurnLifecycle,
  type BaseTurnSessionState,
} from '../../services/agent-service-lifecycle.ts';
import { getSdkPlugin } from '../registry.js';
import { patchAgentInternal } from '../../services/feathers/agents.service.js';
import { METADATA_TIMEOUT_MS } from '../../services/session-metadata.js';

const PI_METADATA_MODEL_ID = 'claude-haiku-4-5';

type PiSessionState = BaseTurnSessionState & {
  piSession: PiAgentSession | null;
  abortController?: AbortController;
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

  /**
   * One Pi turn: token totals from `turn_end` events, USD from the shared
   * agent pricing table.
   */
  async recordTurnUsage(
    session: AgentSessionRow,
    turnUsage: Record<string, unknown>,
    opts: {
      turnModel?: { model: string; modelParams?: unknown };
      patchSessionCost?: boolean;
      agentConfigId?: number | null;
      agentId?: number;
    } = {}
  ): Promise<number> {
    return recordPiTurnUsage(this.app, session, turnUsage, opts);
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
      { agent, db: this.app.get('db') as never, app: this.app, agentSdk: PI_AGENT_SDK_KEY }
    );
    return systemPrompt ? [systemPrompt] : [];
  }

  async _ensurePiDirs(session: AgentSessionRow): Promise<void> {
    const agentDir = piAgentDir(session);
    const sessionsDir = piSessionsDir(session);
    if (agentDir) await mkdir(agentDir, { recursive: true });
    if (sessionsDir) await mkdir(sessionsDir, { recursive: true });
  }

  _openSessionManager(
    session: AgentSessionRow,
    storedPiSessionId?: string | null,
    agent: AgentRow | null = null
  ): SessionManager {
    const cwd = piWorktreeCwd(session, agent);
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
    const cwd = piWorktreeCwd(session, agent);
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
    // Pi's config schema accepts the user's description; Claude and Cursor do
    // not, so only the Pi turn asks for it.
    const userMcp = await loadEnabledMcpServersForSession(this.app, session, {
      withDescription: true,
    });
    await writePiUserMcpConfig(agentDir, userMcp);
    const systemAppend =
      appendSystemPrompt ?? (await this._buildAppendSystemPrompt(session, agent));
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: agentDir ?? cwd,
      settingsManager,
      appendSystemPrompt: systemAppend,
      additionalExtensionPaths: lunaroutePiAdditionalExtensionPaths(envVar),
      // SDK sessions do not load MCP by default (see the SDK docs "Codemode and
      // MCP" and examples/sdk/14-codemode-mcp.ts). The extension's own default
      // loader reads only the global pi agent dir, so it must point at this
      // session's mcp.json (written above from the enabled user MCP servers).
      extensionFactories: [
        createMcpExtension({ loadConfig: () => readPiUserMcpConfig(agentDir) }),
        createSpillOversizedToolResultsExtension(session.id),
      ],
    });
    await resourceLoader.reload();
    const resolvedTools =
      customTools ??
      (getSdkPlugin(PI_AGENT_SDK_KEY)?.adaptTools ?? toolListToPiCustomTools)(
        await buildBaguetteToolList(session, this.app, {
          slackApps: await loadConfiguredSlackApps(this.app),
          agent,
        })
      );
    const sessionManager = this._openSessionManager(session, storedPiSessionId, agent);
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
    // Emits session_start, which loads the loader's extensions and lets the MCP
    // extension connect the user servers in the background and register their
    // mcp__<server>__* tools (same pattern as the SDK's
    // examples/sdk/14-codemode-mcp.ts).
    if (typeof piSession.bindExtensions === 'function') {
      await piSession.bindExtensions({});
    }
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
    await handleAgentMessageCreated({
      app: this.app,
      row,
      expectedSdk: PI_AGENT_SDK_KEY,
      handlingMessageIds: this._handlingMessageIds,
      getActiveTurn: (key) => this._activeSessions.get(key),
      isActiveProcessing: (active) => Boolean(active.isProcessing),
      onActiveTurnMessage: ({ parsed, active }) => {
        if (row.force && active?.piSession?.isStreaming && isSteerableUserMessage(parsed)) {
          const text = extractUserTextFromUserPayload(parsed);
          if (text) void active.piSession.steer(text).catch(() => {});
        }
      },
      onStartTurn: ({ session, agent, parsed, channel, activeKey }) => {
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
          logger.error(
            { sessionId: session.id, err: (err as Error).message },
            'pi-agent turn failed'
          );
        });
      },
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
    error_message?: string | null;
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
      const { finishedOk, turnUsage, lastError } = await processPiSessionStream({
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
      if (finishedOk) {
        outcome = 'completed';
      } else if (controller.signal.aborted) {
        // Deliberate stop (Stop button, agents.stop): the turn was aborted, not failed.
        outcome = 'stopped';
      } else {
        outcome = 'failed';
      }
      return { outcome, turnUsage, error_message: lastError };
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
      return {
        outcome,
        turnUsage: emptyTurnUsage(),
        error_message: (err as Error).name === 'AbortError' ? null : (err as Error).message,
      };
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
    await runAgentTurnLifecycle<PiSessionState, PiTurnUsage>({
      app: this.app,
      sdk: PI_AGENT_SDK_KEY,
      logPrefix: 'pi-agent',
      streamErrorLabel: 'Pi',
      session,
      row,
      meta,
      activeSessions: this._activeSessions,
      registerCompactionHook: true,
      createSessionState: ({ userId, agentId, turnId, channel }) => ({
        isProcessing: true,
        userId,
        agentId,
        piSession: null,
        writer: null,
        turnId,
        channel,
        turnAgentConfigId: null,
      }),
      execute: async ({
        agent,
        channel,
        activeKey,
        turnModel,
        turnAgentConfigId,
        writer,
        sessionState,
      }) => {
        const sessionId = session.id;
        const userId = session.user_id;
        const storedPiSessionId = agent.pi_session_id;
        const model = turnModel.model;

        let agentOptions;
        if (channel === 'review') {
          const extras = getReviewAgentTurn(this.app).peekTurnExtras(sessionId) ?? {};
          const ctx = await getReviewAgentTurn(this.app).prepareReviewContext(session, agent, {
            extraPrompt: extras.extraPrompt,
            model,
            modelParams: turnModel.modelParams,
            agentSdk: PI_AGENT_SDK_KEY,
          });
          const plugin = getSdkPlugin(PI_AGENT_SDK_KEY);
          const reviewerTools = (plugin?.adaptTools ?? toolListToPiCustomTools)(
            buildReviewerAgentTools(session, this.app, ctx.turnAgent)
          );
          agentOptions = await this.buildAgentOptions(session, {
            model,
            modelParams: turnModel.modelParams,
            agentConfigId: turnAgentConfigId,
            customTools: reviewerTools,
            storedPiSessionId: storedPiSessionId as string | null | undefined,
            appendSystemPrompt: ctx.systemPrompt ? [ctx.systemPrompt] : [],
            channel: 'review',
          });
        } else {
          agentOptions = await this.buildAgentOptions(session, {
            model,
            modelParams: turnModel.modelParams,
            channel,
            agentConfigId: turnAgentConfigId,
            storedPiSessionId: storedPiSessionId as string | null | undefined,
            agent,
          });
        }

        const userText = extractUserTextFromUserPayload(parsed);
        if (!writer) {
          throw new Error('pi-agent: missing turn writer');
        }

        return this.runTurn({
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
      },
      recordTurnUsage: (usage, opts) => this.recordTurnUsage(session, usage, opts),
      recordTurnError: (writer, message) => this._recordPiTurnError(writer, message),
    });
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
    await persistAgentStatusMessage(this.app, {
      sessionId,
      userId,
      statusText,
      agentSdk: PI_AGENT_SDK_KEY,
      channel,
      builderAgentId,
    });
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

  /**
   * One-shot completion: send a prompt, return the raw response text.
   * Must resolve within METADATA_TIMEOUT_MS and abort its own session on timeout —
   * callers treat '' as "no completion" and fall back to defaults.
   */
  async completeText(
    prompt: string,
    opts: {
      userId?: number | null;
      agentConfigId?: number | null;
      model?: string | null;
    } = {}
  ): Promise<string> {
    const config =
      opts.userId != null ? await this.loadAgentConfig(opts.userId, opts.agentConfigId) : null;
    const { apiKey, envVar } = resolvePiCredentials(config);
    if (!apiKey) {
      return '';
    }

    const modelRuntime = await createPiModelRuntime(apiKey, envVar);
    const modelId = opts.model || PI_METADATA_MODEL_ID;

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
      return '';
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
          timer = setTimeout(() => reject(new Error('Completion timed out')), METADATA_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // fall back to an empty completion
    } finally {
      if (timer) clearTimeout(timer);
      unsubscribe();
      try {
        await piSession.abort();
      } catch {
        // ignore
      }
    }

    return collectedText.trim();
  }

  /**
   * TODO: run loop compaction through a Pi plugin when one supports it; until then, re-send the prompt only.
   */
  async prepareTiedSessionLoopCompaction(args: TiedSessionLoopCompactionArgs): Promise<void> {
    await directPromptTiedSessionLoopCompaction(this.app, args);
  }

  async isInterruptedSessionResumable(
    session: AgentSessionRow,
    opts: { channel?: MessageChannel; agent?: AgentRow } = {}
  ): Promise<boolean> {
    return isAgentSessionResumable(this.app, session, 'pi_session_id', opts);
  }
}

export function registerPiAgentService(app: AgentApp, path = PI_AGENT_SERVICE_PATH) {
  registerInternalAgentService(app, {
    service: new PiAgentService(),
    path,
    methods: [
      'stopSession',
      'stopTurn',
      'runTurn',
      'buildAgentOptions',
      'completeText',
      'prepareTiedSessionLoopCompaction',
      'handleMessageCreated',
      'isInterruptedSessionResumable',
    ],
    key: PI_AGENT_SDK_KEY,
    label: PI_AGENT_SDK_LABEL,
  });
}
