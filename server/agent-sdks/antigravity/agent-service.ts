import os from 'node:os';
import type { McpServer as AcpMcpServer } from '@agentclientprotocol/sdk/unstable';
import logger from '../../logger.js';
import { resolveDataDirRelativePath } from '../../config.js';
import { buildBaguetteToolList, buildReviewerAgentTools } from '../../services/mcp/server.js';
import { loadConfiguredSlackApps } from '../../services/mcp/lib/slack.js';
import { loadEnabledMcpServersForSession } from '../../services/user-mcp-runtime.js';
import { buildSystemPromptAppend } from '../../services/session-prompt.js';
import { emptyTurnUsage } from '../../services/turn-usage.js';
import { extractUserTextFromUserPayload } from '../../../shared/user-message-content.js';
import { attachAppErrorHandler } from '../../lib/app-error-handler.js';
import { loadOwnedAgentConfigDecrypted } from '../../services/agent-context.js';
import { coerceAgentConfigId, requireAgentConfigId } from '../../lib/usage-snapshot.js';
import { getReviewAgentTurn, reviewTurnKey } from '../../services/review-agent-turn.js';
import { agentWorktreeCwd } from '../../services/subagent-worktree.js';
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
import { patchAgentInternal } from '../../services/feathers/agents.service.js';
import { METADATA_TIMEOUT_MS } from '../../services/session-metadata.js';
import {
  handleAgentMessageCreated,
  isAgentSessionResumable,
  persistAgentStatusMessage,
  registerInternalAgentService,
  runAgentTurnLifecycle,
  type BaseTurnSessionState,
} from '../../services/agent-service-lifecycle.ts';
import { getSdkPlugin } from '../registry.js';
import {
  ANTIGRAVITY_AGENT_SDK_KEY,
  ANTIGRAVITY_AGENT_SDK_LABEL,
  ANTIGRAVITY_AGENT_SERVICE_PATH,
} from './meta.js';
import { buildAntigravityEnv, parseExtraEnvJson, resolveAgyBinary } from './env.js';
import { toolListToAntigravityMcpTools } from './adapt-tools.js';
import { startAntigravityMcpBridge, type AntigravityMcpToolDescriptor } from './mcp-bridge.ts';
import {
  AcpProcessClient,
  type AcpClientLike,
  type AcpSessionWithModels,
  type AcpSpawnOptions,
} from './acp-client.ts';
import {
  antigravityThoughtLevelFromModelParams,
  stripAntigravityThoughtSuffix,
} from './model-params.js';
import { antigravityTurnResultOps } from './mapping.ts';
import { processAntigravityTurnStream, type AntigravityTurnUsage } from './sdk-turn.ts';
import { recordAntigravityTurnUsage } from './record-turn-usage.js';

type AntigravitySessionState = BaseTurnSessionState & {
  acpClient: AcpClientLike | null;
  acpSessionId?: string | null;
  abortController?: AbortController;
};

export type AntigravityBuildAgentOptionsResult = {
  cwd: string;
  binary: string;
  env: Record<string, string | undefined>;
  apiKey: string | null;
  model: string | null;
  modelParams: unknown;
  systemPromptAppend: string | null;
  userMcpServers: AcpMcpServer[];
  baguetteTools: AntigravityMcpToolDescriptor[];
  storedAntigravitySessionId: string | null;
  channel: MessageChannel;
};

export type AntigravityServiceDeps = {
  spawnClient?: (opts: AcpSpawnOptions) => AcpClientLike;
  startMcpBridge?: typeof startAntigravityMcpBridge;
};

type UserMcpEntry = {
  type?: string;
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

export function toAcpMcpServers(
  userMcpMap: Record<string, UserMcpEntry> | null | undefined
): AcpMcpServer[] {
  if (!userMcpMap || typeof userMcpMap !== 'object') return [];
  const servers: AcpMcpServer[] = [];

  for (const [name, entry] of Object.entries(userMcpMap)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.type === 'sse' && typeof entry.url === 'string' && entry.url) {
      servers.push({
        type: 'sse',
        name,
        url: entry.url,
        headers: Object.entries(entry.headers ?? {}).map(([k, v]) => ({
          name: k,
          value: String(v),
        })),
      });
      continue;
    }
    if ((entry.type === 'http' || !entry.type) && typeof entry.url === 'string' && entry.url) {
      servers.push({
        type: 'http',
        name,
        url: entry.url,
        headers: Object.entries(entry.headers ?? {}).map(([k, v]) => ({
          name: k,
          value: String(v),
        })),
      });
      continue;
    }
    if (typeof entry.command === 'string' && entry.command) {
      servers.push({
        name,
        command: entry.command,
        args: Array.isArray(entry.args) ? entry.args.map(String) : [],
        env: Object.entries(entry.env ?? {}).map(([k, v]) => ({ name: k, value: String(v) })),
      });
    }
  }

  return servers;
}

function isAuthRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === -32000) return true;
  const msg = (err as { message?: unknown }).message;
  if (typeof msg !== 'string') return false;
  const lower = msg.toLowerCase();
  return lower.includes('authentication required') || lower.includes('auth required');
}

async function applyAcpSessionModel(
  client: AcpClientLike,
  acpSessionId: string,
  sessionResult: AcpSessionWithModels,
  modelId: string,
  modelParams: unknown
): Promise<void> {
  const thoughtLevel = antigravityThoughtLevelFromModelParams(modelParams);
  const baseId = stripAntigravityThoughtSuffix(modelId) || modelId;
  const availableModels = Array.isArray(sessionResult?.models?.availableModels)
    ? sessionResult.models.availableModels
    : [];
  const currentModelId = sessionResult?.models?.currentModelId ?? null;
  const availableIds = new Set(
    availableModels.map((m) => m?.modelId).filter((id): id is string => Boolean(id))
  );

  if (thoughtLevel) {
    const composed = `${baseId}-${thoughtLevel}`;
    if (availableIds.has(composed)) {
      if (currentModelId !== composed) {
        await client.setModel(acpSessionId, composed);
      }
      return;
    }
  }

  if (availableIds.has(modelId)) {
    if (currentModelId !== modelId) {
      await client.setModel(acpSessionId, modelId);
    }
    return;
  }

  const configOptions = Array.isArray(sessionResult?.configOptions)
    ? sessionResult.configOptions
    : [];
  const modelOpt = configOptions.find(
    (opt) => opt && (opt.id === 'model' || opt.category === 'model') && opt.type === 'select'
  );
  if (modelOpt) {
    await client.setConfigOption(acpSessionId, modelOpt.id, baseId);
    if (thoughtLevel) {
      const thoughtOpt = configOptions.find(
        (opt) =>
          opt &&
          (opt.id === 'thought_level' ||
            opt.id === 'reasoning' ||
            opt.category === 'thought_level') &&
          opt.type === 'select'
      );
      if (thoughtOpt) {
        await client.setConfigOption(acpSessionId, thoughtOpt.id, thoughtLevel);
      }
    }
    return;
  }

  const fallbackModel = thoughtLevel ? `${baseId}-${thoughtLevel}` : modelId;
  try {
    await client.setModel(acpSessionId, fallbackModel);
  } catch {
    await client.setConfigOption(acpSessionId, 'model', baseId);
  }
}

async function authenticateAndRetry<T>(
  client: AcpClientLike,
  apiKey: string | null,
  action: () => Promise<T>
): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (isAuthRequiredError(err) && apiKey) {
      await client.authenticate('gemini-api-key');
      return action();
    }
    throw err;
  }
}

export class AntigravityAgentService {
  app!: AgentApp;
  private _handlingMessageIds = new Set<number>();
  private _activeSessions = new Map<string | number, AntigravitySessionState>();
  private _spawnClient: (opts: AcpSpawnOptions) => AcpClientLike;
  private _startMcpBridge: typeof startAntigravityMcpBridge;

  constructor(deps: AntigravityServiceDeps = {}) {
    this._spawnClient = deps.spawnClient ?? ((opts) => AcpProcessClient.spawn(opts));
    this._startMcpBridge = deps.startMcpBridge ?? startAntigravityMcpBridge;
  }

  setup(app: AgentApp) {
    this.app = app;
  }

  async recordTurnUsage(
    session: AgentSessionRow,
    turnUsage: Record<string, unknown>,
    opts: {
      turnModel?: { model?: string | null; modelParams?: unknown };
      patchSessionCost?: boolean;
      agentConfigId?: number | null;
      agentId?: number;
    } = {}
  ): Promise<number> {
    return recordAntigravityTurnUsage(this.app, session, turnUsage, opts);
  }

  private async loadAgentConfig(userId: number, agentConfigId?: number | null) {
    const configId = coerceAgentConfigId(agentConfigId);
    return loadOwnedAgentConfigDecrypted(configId, userId, this.app.get('db') as DbLike as never);
  }

  async _buildAppendSystemPrompt(
    session: AgentSessionRow,
    agent?: AgentRow | null
  ): Promise<string | null> {
    if (!session.session_path) return null;
    const absoluteCwd = resolveDataDirRelativePath(session.session_path);
    const systemPrompt = await buildSystemPromptAppend(
      {
        ...session,
        absolute_session_path: absoluteCwd,
      },
      { agent, db: this.app.get('db') as never, app: this.app, agentSdk: ANTIGRAVITY_AGENT_SDK_KEY }
    );
    return systemPrompt || null;
  }

  async buildAgentOptions(
    session: AgentSessionRow,
    {
      model,
      modelParams,
      customTools,
      channel = 'chat',
      agentConfigId,
      storedAntigravitySessionId,
      appendSystemPrompt,
      agent,
    }: {
      model?: string | null;
      modelParams?: unknown;
      customTools?: AntigravityMcpToolDescriptor[];
      channel?: MessageChannel;
      agentConfigId?: number | null;
      storedAntigravitySessionId?: string | null;
      appendSystemPrompt?: string | null;
      agent?: AgentRow | null;
    } = {}
  ): Promise<AntigravityBuildAgentOptionsResult> {
    const cwd = agentWorktreeCwd(session, agent) ?? os.tmpdir();
    const configId = requireAgentConfigId(agentConfigId);
    const agentConfig = await this.loadAgentConfig(session.user_id, configId);
    const db = this.app.get('db') as DbLike;
    const user = await db('users').where({ id: session.user_id }).first();
    const extraEnv = parseExtraEnvJson(agentConfig?.extra_env_json);
    const binary = resolveAgyBinary(extraEnv);
    const env = buildAntigravityEnv(agentConfig, user);
    const apiKey =
      typeof agentConfig?.api_key === 'string' && agentConfig.api_key.trim()
        ? agentConfig.api_key.trim()
        : null;

    const userMcpRaw = (await loadEnabledMcpServersForSession(this.app, session)) as Record<
      string,
      UserMcpEntry
    >;
    const userMcpServers = toAcpMcpServers(userMcpRaw);

    const systemPromptAppend =
      appendSystemPrompt !== undefined
        ? appendSystemPrompt
        : await this._buildAppendSystemPrompt(session, agent);

    const resolvedTools =
      customTools ??
      ((getSdkPlugin(ANTIGRAVITY_AGENT_SDK_KEY)?.adaptTools ?? toolListToAntigravityMcpTools)(
        await buildBaguetteToolList(session, this.app, {
          slackApps: await loadConfiguredSlackApps(this.app),
          agent,
        })
      ) as AntigravityMcpToolDescriptor[]);

    return {
      cwd,
      binary,
      env,
      apiKey,
      model: model ?? null,
      modelParams: modelParams ?? null,
      systemPromptAppend: systemPromptAppend ?? null,
      userMcpServers,
      baguetteTools: resolvedTools,
      storedAntigravitySessionId: storedAntigravitySessionId ?? null,
      channel,
    };
  }

  private async _openTurnSession(
    client: AcpClientLike,
    agentOptions: AntigravityBuildAgentOptionsResult,
    mcpServers: AcpMcpServer[]
  ): Promise<{ acpSessionId: string; sessionResult: AcpSessionWithModels }> {
    const { cwd, apiKey, systemPromptAppend, storedAntigravitySessionId } = agentOptions;

    if (storedAntigravitySessionId) {
      try {
        const resumed = await authenticateAndRetry(client, apiKey, () =>
          client.resumeSession({
            sessionId: storedAntigravitySessionId,
            cwd,
            mcpServers,
            systemPromptAppend,
          })
        );
        const resumedId = resumed.sessionId ?? storedAntigravitySessionId;
        return { acpSessionId: resumedId, sessionResult: resumed };
      } catch (err) {
        if (isAuthRequiredError(err)) throw err;
        logger.warn(
          { sessionId: storedAntigravitySessionId, err: (err as Error).message },
          'antigravity-agent: resumeSession failed, creating fresh ACP session'
        );
      }
    }

    const created = await authenticateAndRetry(client, apiKey, () =>
      client.newSession({
        cwd,
        mcpServers,
        systemPromptAppend,
      })
    );
    if (!created.sessionId) {
      throw new Error('Antigravity ACP newSession did not return a sessionId');
    }
    return { acpSessionId: created.sessionId, sessionResult: created };
  }

  async handleMessageCreated(row: MessageRowLike) {
    await handleAgentMessageCreated({
      app: this.app,
      row,
      expectedSdk: ANTIGRAVITY_AGENT_SDK_KEY,
      handlingMessageIds: this._handlingMessageIds,
      getActiveTurn: (key) => this._activeSessions.get(key),
      isActiveProcessing: (active) => Boolean(active.isProcessing),
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
            'antigravity-agent turn failed'
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
    persistAntigravitySessionId,
    persistStatus,
    activeKey,
    abortController,
    activeSessionState,
  }: {
    session: AgentSessionRow;
    userText: string;
    agentOptions: AntigravityBuildAgentOptionsResult;
    writer: MessageStreamWriter;
    persistAntigravitySessionId?: (sessionId: string) => Promise<unknown> | unknown;
    persistStatus?: (text: string) => Promise<void>;
    activeKey?: string | number;
    abortController?: AbortController;
    activeSessionState?: AntigravitySessionState;
  }): Promise<{
    outcome: 'completed' | 'failed' | 'stopped';
    turnUsage?: AntigravityTurnUsage;
    error_message?: string | null;
  }> {
    const key = activeKey ?? session.id;
    const controller = abortController ?? new AbortController();
    const ownsActiveSession = activeSessionState == null;
    const sessionState: AntigravitySessionState = activeSessionState ?? {
      isProcessing: true,
      userId: session.user_id,
      acpClient: null,
    };
    sessionState.abortController = controller;
    if (ownsActiveSession) {
      this._activeSessions.set(key, sessionState);
    }

    let outcome: 'completed' | 'failed' | 'stopped' = 'failed';
    let streamStarted = false;
    let mcpBridge: Awaited<ReturnType<typeof startAntigravityMcpBridge>> | null = null;
    let acpClient: AcpClientLike | null = null;
    let acpSessionId: string | null = null;

    try {
      if (agentOptions.baguetteTools.length > 0) {
        mcpBridge = await this._startMcpBridge(agentOptions.baguetteTools, {
          serverName: 'baguette',
        });
      }
      const mcpServers: AcpMcpServer[] = mcpBridge
        ? [...agentOptions.userMcpServers, mcpBridge.acpServerConfig]
        : [...agentOptions.userMcpServers];

      acpClient = this._spawnClient({
        binary: agentOptions.binary,
        cwd: agentOptions.cwd,
        env: agentOptions.env,
      });
      sessionState.acpClient = acpClient;

      await acpClient.initialize();

      const opened = await this._openTurnSession(acpClient, agentOptions, mcpServers);
      acpSessionId = opened.acpSessionId;
      sessionState.acpSessionId = acpSessionId;

      if (acpSessionId) {
        await persistAntigravitySessionId?.(acpSessionId);
      }

      if (agentOptions.model) {
        await applyAcpSessionModel(
          acpClient,
          acpSessionId,
          opened.sessionResult,
          agentOptions.model,
          agentOptions.modelParams
        );
      }

      streamStarted = true;
      const openedSessionId = acpSessionId;
      const { finishedOk, turnUsage, lastError } = await processAntigravityTurnStream({
        writer,
        subscribe: (listener) => acpClient!.onSessionUpdate(listener),
        runPrompt: () =>
          acpClient!.prompt(
            {
              sessionId: openedSessionId,
              prompt: [{ type: 'text', text: userText }],
            },
            { cancellationSignal: controller.signal, stopWaitingOnCancel: true }
          ),
        consumeMcpToolResult: mcpBridge
          ? (shortName) => mcpBridge!.consumeToolResult(shortName)
          : undefined,
        model: agentOptions.model,
        abortSignal: controller.signal,
      });

      if (finishedOk) {
        outcome = 'completed';
      } else if (controller.signal.aborted) {
        outcome = 'stopped';
      } else {
        outcome = 'failed';
      }
      return { outcome, turnUsage, error_message: lastError };
    } catch (err) {
      if ((err as Error).name === 'AbortError' || controller.signal.aborted) {
        outcome = 'stopped';
        return {
          outcome,
          turnUsage: emptyTurnUsage(),
          error_message: null,
        };
      }
      logger.error(
        { sessionId: session.id, err: (err as Error).message },
        'Antigravity session stream error'
      );
      try {
        if (!streamStarted) {
          await this._recordAntigravityTurnError(writer, (err as Error).message);
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
      return {
        outcome,
        turnUsage: emptyTurnUsage(),
        error_message: (err as Error).message,
      };
    } finally {
      if (!streamStarted) {
        try {
          await writer.finish();
        } catch {
          // ignore writer cleanup errors
        }
      }
      if (acpClient && acpSessionId) {
        await acpClient.closeSession(acpSessionId).catch(() => {});
      }
      if (acpClient) {
        await acpClient.close().catch(() => {});
      }
      if (mcpBridge) {
        await mcpBridge.close().catch(() => {});
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
      if (session.acpClient && session.acpSessionId) {
        await session.acpClient.cancel(session.acpSessionId);
      }
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
    await runAgentTurnLifecycle<AntigravitySessionState, AntigravityTurnUsage>({
      app: this.app,
      sdk: ANTIGRAVITY_AGENT_SDK_KEY,
      logPrefix: 'antigravity-agent',
      streamErrorLabel: 'Antigravity',
      session,
      row,
      meta,
      activeSessions: this._activeSessions,
      registerCompactionHook: true,
      createSessionState: ({ userId, agentId, turnId, channel }) => ({
        isProcessing: true,
        userId,
        agentId,
        acpClient: null,
        acpSessionId: null,
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
        const storedAntigravitySessionId = agent.antigravity_session_id;
        const model = turnModel.model;

        let agentOptions: AntigravityBuildAgentOptionsResult;
        if (channel === 'review') {
          const extras = getReviewAgentTurn(this.app).peekTurnExtras(sessionId) ?? {};
          const ctx = await getReviewAgentTurn(this.app).prepareReviewContext(session, agent, {
            extraPrompt: extras.extraPrompt,
            model,
            modelParams: turnModel.modelParams,
            agentSdk: ANTIGRAVITY_AGENT_SDK_KEY,
          });
          const plugin = getSdkPlugin(ANTIGRAVITY_AGENT_SDK_KEY);
          const reviewerTools = (plugin?.adaptTools ?? toolListToAntigravityMcpTools)(
            buildReviewerAgentTools(session, this.app, ctx.turnAgent)
          ) as AntigravityMcpToolDescriptor[];
          agentOptions = await this.buildAgentOptions(session, {
            model,
            modelParams: turnModel.modelParams,
            agentConfigId: turnAgentConfigId,
            customTools: reviewerTools,
            storedAntigravitySessionId: storedAntigravitySessionId ?? null,
            appendSystemPrompt: ctx.systemPrompt || null,
            channel: 'review',
            agent,
          });
        } else {
          agentOptions = await this.buildAgentOptions(session, {
            model,
            modelParams: turnModel.modelParams,
            channel,
            agentConfigId: turnAgentConfigId,
            storedAntigravitySessionId: storedAntigravitySessionId ?? null,
            agent,
          });
        }

        const userText = extractUserTextFromUserPayload(parsed);
        if (!writer) {
          throw new Error('antigravity-agent: missing turn writer');
        }

        return this.runTurn({
          session,
          userText,
          agentOptions,
          writer,
          activeKey,
          activeSessionState: sessionState,
          persistAntigravitySessionId: (acpSessionId) =>
            patchAgentInternal(
              this.app,
              agent.id,
              { antigravity_session_id: acpSessionId },
              userId
            ),
          persistStatus: async (text) => {
            await this._persistStatusMessage(sessionId, userId, text, session, channel, agent.id);
          },
        });
      },
      recordTurnUsage: (usage, opts) => this.recordTurnUsage(session, usage, opts),
      recordTurnError: (writer, message) => this._recordAntigravityTurnError(writer, message),
    });
  }

  async _recordAntigravityTurnError(
    writer: MessageStreamWriter | null | undefined,
    message: string
  ) {
    const text = String(message ?? '').trim();
    if (!writer || !text) return;
    await writer.apply(antigravityTurnResultOps('error', text));
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
      agentSdk: ANTIGRAVITY_AGENT_SDK_KEY,
      channel,
      builderAgentId,
    });
  }

  async stopSession(sessionId: number) {
    await this.stopTurn(sessionId);
    await this.stopTurn(reviewTurnKey(sessionId));
  }

  getActiveSession(sessionId: string | number): AntigravitySessionState | null {
    return this._activeSessions.get(sessionId) ?? null;
  }

  async get(id: number) {
    return this.getActiveSession(id);
  }

  /**
   * One-shot completion: send a prompt, return the raw response text.
   * Must resolve within `METADATA_TIMEOUT_MS` — callers treat `''` as "no completion".
   */
  async completeText(
    prompt: string,
    opts: {
      userId?: number | null;
      agentConfigId?: number | null;
      model?: string | null;
      modelParams?: unknown;
    } = {}
  ): Promise<string> {
    const config =
      opts.userId != null ? await this.loadAgentConfig(opts.userId, opts.agentConfigId) : null;
    const extraEnv = parseExtraEnvJson(config?.extra_env_json);
    const binary = resolveAgyBinary(extraEnv);
    const env = buildAntigravityEnv(config, null);
    const apiKey =
      typeof config?.api_key === 'string' && config.api_key.trim() ? config.api_key.trim() : null;

    const acpClient = this._spawnClient({ binary, cwd: os.tmpdir(), env });
    const abortController = new AbortController();
    let acpSessionId: string | null = null;
    let collectedText = '';
    let timer: ReturnType<typeof setTimeout> | undefined;

    const unsubscribe = acpClient.onSessionUpdate((notification) => {
      const update = notification?.update;
      if (
        update?.sessionUpdate === 'agent_message_chunk' &&
        update.content?.type === 'text' &&
        update.content.text
      ) {
        collectedText += update.content.text;
      }
    });

    try {
      const work = (async () => {
        await acpClient.initialize();
        const created = await authenticateAndRetry(acpClient, apiKey, () =>
          acpClient.newSession({ cwd: os.tmpdir(), mcpServers: [] })
        );
        if (!created.sessionId) return;
        acpSessionId = created.sessionId;
        if (opts.model) {
          await applyAcpSessionModel(
            acpClient,
            acpSessionId,
            created,
            opts.model,
            opts.modelParams
          );
        }
        await acpClient.prompt(
          {
            sessionId: acpSessionId,
            prompt: [{ type: 'text', text: prompt }],
          },
          { cancellationSignal: abortController.signal, stopWaitingOnCancel: true }
        );
      })();

      await Promise.race([
        work,
        new Promise<void>((_, reject) => {
          timer = setTimeout(() => {
            abortController.abort();
            reject(new Error('Completion timed out'));
          }, METADATA_TIMEOUT_MS);
        }),
      ]);
    } catch {
      return '';
    } finally {
      if (timer) clearTimeout(timer);
      unsubscribe();
      if (acpSessionId) {
        await acpClient.cancel(acpSessionId).catch(() => {});
        await acpClient.closeSession(acpSessionId).catch(() => {});
      }
      await acpClient.close().catch(() => {});
    }

    return collectedText.trim();
  }

  async prepareTiedSessionLoopCompaction(args: TiedSessionLoopCompactionArgs): Promise<void> {
    await directPromptTiedSessionLoopCompaction(this.app, args);
  }

  async isInterruptedSessionResumable(
    session: AgentSessionRow,
    opts: { channel?: MessageChannel; agent?: AgentRow } = {}
  ): Promise<boolean> {
    return isAgentSessionResumable(this.app, session, 'antigravity_session_id', opts);
  }
}

export function registerAntigravityAgentService(
  app: AgentApp,
  path = ANTIGRAVITY_AGENT_SERVICE_PATH
) {
  registerInternalAgentService(app, {
    service: new AntigravityAgentService(),
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
    key: ANTIGRAVITY_AGENT_SDK_KEY,
    label: ANTIGRAVITY_AGENT_SDK_LABEL,
  });
}
