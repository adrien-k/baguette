import {
  Agent,
  AgentBusyError,
  UnsupportedRunOperationError,
  type SDKStatusMessage,
  type SDKUsageMessage,
} from '@cursor/sdk';
import type {
  AgentOptions,
  ModelParameterValue,
  Run,
  RunResult,
  SDKAgent,
  SDKCustomTool,
  SettingSource,
} from '@cursor/sdk';
import { SqliteLocalAgentStore } from '@cursor/sdk/sqlite';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cursorSdkStateRoot, cursorWorkspaceRef } from '../cursor/cursor-session-paths.js';
import logger from '../../logger.js';
import { disableExternal } from './hooks.js';
import { resolveDataDirRelativePath, DATA_DIR } from '../../config.js';
import { buildCursorCustomTools } from '../baguette-mcp-server.js';
import { buildSystemPromptAppend } from '../session-prompt.js';
import { addTokenUsage, emptyTurnUsage } from '../turn-usage.js';
import {
  processCursorRunStream,
  type CursorStreamStatusCallback,
  type CursorStreamUsageCallback,
  type ProcessCursorRunStreamResult,
} from '../cursor/cursor-sdk-turn.ts';
import {
  cursorSilentEndStatusText,
  cursorTerminalStatusSurfacing,
} from '../cursor/cursor-turn-error.ts';
import { extractUserTextFromUserPayload } from '../../../shared/user-message-content.js';
import { isSteerableUserMessage, requireTurnModelFromRow } from '../../../shared/turn-model.js';
import { attachAppErrorHandler, handleAppError } from '../../lib/app-error-handler.js';
import { loadOwnedAgentConfigDecrypted } from '../agent-context.js';
import { requireAgentConfigId } from '../../lib/usage-snapshot.js';
import { loadModelsForSdk } from '../baguette-models-for-user.js';
import { parseCursorModelPrefsJson } from '../agent-preferences.js';
import { resolveCursorAgentModelParams } from '../cursor-model-params.js';
import { getReviewAgentTurn, reviewTurnKey } from '../review-agent-turn.js';
import {
  isDispatchableUserMessage,
  parseUserRow,
  rejectTurnMismatch,
} from '../agent-message-dispatch.js';
import { createMessageStreamWriter } from '../message-writer-factory.ts';
import { sessionMessageIdentity } from './message-create-fields.js';
import type { MessageStreamWriter } from '../../../shared/message-stream-writer.ts';
import type { SystemMessagePayload } from '../../../shared/session-messages.ts';
import {
  CURSOR_AGENT_SDK_KEY,
  CURSOR_AGENT_SDK_LABEL,
  CURSOR_AGENT_SERVICE_PATH,
} from '../agent-sdk-meta.js';
import { registerAgentSdk } from './agent-configs.service.js';
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

const CURSOR_CHEAP_MODEL_ID = 'claude-haiku-4-5';

const SYSTEM_PROMPT_RULE_FILENAME = 'system-prompt.mdc';
const PROMPT_RULE_MODES = ['build', 'review'];

/** Per-turn token usage accumulator (see turn-usage.js). */
type TurnUsage = Omit<ReturnType<typeof emptyTurnUsage>, 'model'> & {
  model?: string | null;
  raw_token_usage?: unknown;
};

/** Active Cursor run state for a session/chat key. */
type CursorSessionState = {
  isProcessing: boolean;
  userId: number;
  agentId?: number;
  currentRun: Run | null;
  abortController?: AbortController;
  writer?: MessageStreamWriter | null;
  turnId?: number | null;
  channel?: MessageChannel;
  turnAgentConfigId?: number | null;
  endTurnAwaitingUser?: boolean;
  /** Set by stopTurn so a subsequent CANCELLED is treated as a deliberate stop. */
  stopRequested?: boolean;
};

type StreamOneRunOpts = {
  activeKey?: string | number;
  channel?: MessageChannel;
  writer?: MessageStreamWriter | null;
  abortSignal?: AbortSignal;
  onUsage?: CursorStreamUsageCallback;
  onStatus?: CursorStreamStatusCallback;
};

type StreamOneRunResult = ProcessCursorRunStreamResult;

export class CursorAgentService {
  app!: AgentApp;
  private _handlingMessageIds = new Set<number>();
  private _activeSessions: Map<string | number, CursorSessionState>;
  private _sessionStores: Map<number, SqliteLocalAgentStore>;

  constructor() {
    this._activeSessions = new Map();
    this._sessionStores = new Map();
  }

  async openSessionStore(session: AgentSessionRow): Promise<SqliteLocalAgentStore> {
    const sessionId = session.id;
    if (sessionId != null) {
      const cached = this._sessionStores.get(sessionId);
      if (cached) return cached;
    }
    const store = await SqliteLocalAgentStore.open({
      workspaceRef: cursorWorkspaceRef(session),
      stateRoot: cursorSdkStateRoot(session) ?? join(DATA_DIR, 'cursor-sdk-store'),
    });
    if (sessionId != null) this._sessionStores.set(sessionId, store);
    return store;
  }

  /** Drop the in-memory store handle only; on-disk state stays for {@link Agent.resume}. */
  async disposeSessionStore(sessionId: number): Promise<void> {
    this._sessionStores.delete(sessionId);
  }

  setup(app: AgentApp) {
    this.app = app;
  }

  async writeAlwaysApplyRule(
    rulesRoot: string,
    {
      filename = SYSTEM_PROMPT_RULE_FILENAME,
      description,
      body,
    }: { filename?: string; description: string; body: string }
  ): Promise<string> {
    const rulesDir = join(rulesRoot, '.cursor', 'rules');
    await mkdir(rulesDir, { recursive: true });
    await writeFile(
      join(rulesDir, filename),
      `---
description: ${description}
alwaysApply: true
---

${body}`,
      'utf8'
    );
    return rulesRoot;
  }

  cursorDirForSession(session: AgentSessionRow): string | null {
    const absoluteCwd = resolveDataDirRelativePath(session.session_path);
    if (!absoluteCwd) return null;
    return join(dirname(absoluteCwd), 'cursor-dir');
  }

  async writePromptRule(
    session: AgentSessionRow,
    mode: string,
    { description, body }: { description: string; body: string }
  ): Promise<string | null> {
    if (!PROMPT_RULE_MODES.includes(mode)) {
      throw new Error(`Unknown cursor prompt mode: ${mode}`);
    }
    const cursorDir = this.cursorDirForSession(session);
    if (!cursorDir) return null;
    const rulesRoot = join(cursorDir, mode);
    await this.writeAlwaysApplyRule(rulesRoot, { description, body });
    return rulesRoot;
  }

  async resolveApiKey(
    session: AgentSessionRow,
    _channel: MessageChannel = 'chat',
    agentConfigId?: number | null
  ): Promise<string | undefined> {
    return (await this.loadAgentConfigApiKey(session.user_id, agentConfigId)) || undefined;
  }

  /** API key from the owned agent_configs row for this turn (or metadata generation). */
  private async loadAgentConfigApiKey(
    userId: number,
    agentConfigId?: number | null
  ): Promise<string | null> {
    const db = this.app.get('db') as DbLike;
    const configId = requireAgentConfigId(agentConfigId);
    const config = await loadOwnedAgentConfigDecrypted(configId, userId, db as never);
    return config?.api_key || null;
  }

  parseModelParams(modelParams: unknown): ModelParameterValue[] | null {
    if (!modelParams) return null;
    if (typeof modelParams !== 'string') return modelParams as ModelParameterValue[];
    try {
      return JSON.parse(modelParams) as ModelParameterValue[];
    } catch {
      return null;
    }
  }

  async buildAgentOptions(
    session: AgentSessionRow,
    {
      customTools,
      settingSources = ['project'],
      dirs,
      model,
      modelParams,
      apiKey,
      channel = 'chat',
      agentConfigId,
      agent,
    }: {
      customTools?: unknown;
      settingSources?: string[];
      dirs?: string[];
      model?: string | null;
      modelParams?: unknown;
      apiKey?: string | undefined;
      channel?: MessageChannel;
      /** The turn's agent config snapshot (from the message row). */
      agentConfigId?: number | null;
      agent?: AgentRow | null;
    } = {}
  ): Promise<AgentOptions> {
    const cwd = resolveDataDirRelativePath(session.session_path) || '';
    const configId = requireAgentConfigId(agentConfigId);
    const resolvedApiKey =
      apiKey !== undefined ? apiKey : await this.resolveApiKey(session, channel, configId);
    const resolvedTools =
      customTools ?? (await buildCursorCustomTools(session, this.app, { agent }));
    const store = await this.openSessionStore(session);
    const agentOptions = {
      apiKey: resolvedApiKey,
      local: {
        cwd,
        store,
        settingSources: settingSources as unknown as SettingSource[],
        dirs: dirs ?? [],
        customTools: resolvedTools as unknown as Record<string, SDKCustomTool>,
      },
    } as AgentOptions;
    const modelId = model ?? null;
    if (modelId) {
      let params = this.parseModelParams(modelParams);
      if (session.repo_id) {
        try {
          const user = await this.app.service('users').get(session.user_id, {});
          const userRepos = await this.app.service('user-repos').find({
            query: { repo_id: session.repo_id },
            user: { id: session.user_id },
            paginate: false,
          });
          const repo = userRepos?.[0] ?? null;
          if (repo) {
            const models = await loadModelsForSdk(user, 'cursor', repo, this.app, {
              agentConfigId: configId,
            });
            const prefs = parseCursorModelPrefsJson(user.agent_preferences);
            params = resolveCursorAgentModelParams({
              models,
              modelId,
              modelParams: (params ?? modelParams) as
                string | ModelParameterValue[] | null | undefined,
              cursorModelPrefs: prefs,
            });
          }
        } catch (err) {
          logger.warn(
            { sessionId: session.id, modelId, err: (err as Error).message },
            'cursor-agent: could not resolve model params from registry'
          );
        }
      }
      agentOptions.model = params?.length ? { id: modelId, params } : { id: modelId };
    }
    return agentOptions;
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
    if (sdk !== 'cursor') return;

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
      if (row.force && active.currentRun?.steer && isSteerableUserMessage(parsed)) {
        const text = extractUserTextFromUserPayload(parsed);
        if (text) active.currentRun.steer(text).catch(() => {});
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
      logger.error({ sessionId, err: (err as Error).message }, 'cursor-agent turn failed');
    });
  }

  async _prepareGlobalRulesDir(
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
      { agent }
    );
    return this.writePromptRule(session, 'build', {
      description: 'Baguette session rules (always applied)',
      body: systemPrompt,
    });
  }

  async _getPluginDirs(session: AgentSessionRow): Promise<string[]> {
    if (!session.plugins) return [];
    try {
      const pluginIds: unknown = JSON.parse(session.plugins);
      if (!Array.isArray(pluginIds) || pluginIds.length === 0) return [];
      const pluginRows = await (this.app.get('db') as DbLike)('plugins').whereIn('id', pluginIds);
      const dirs: string[] = [];
      for (const p of pluginRows) {
        const pluginRoot = resolveDataDirRelativePath(p.local_path as string) ?? '';
        try {
          await access(join(pluginRoot, '.cursor', 'rules'));
          dirs.push(pluginRoot);
        } catch {
          // plugin has no .cursor/rules/, skip
        }
      }
      return dirs;
    } catch {
      return [];
    }
  }

  async createOrResumeAgent(
    session: AgentSessionRow,
    {
      agentOptions,
      resumeAgentId,
      persistAgentId,
    }: {
      agentOptions: AgentOptions;
      resumeAgentId?: string | null;
      persistAgentId?: (agentId: string) => Promise<unknown> | unknown;
    }
  ): Promise<SDKAgent> {
    const sessionId = session.id;
    let agent: SDKAgent | undefined;
    if (resumeAgentId) {
      logger.info(
        { sessionId, storedAgentId: resumeAgentId },
        'cursor-agent: resuming stored agent'
      );
      try {
        agent = await Agent.resume(resumeAgentId, agentOptions);
      } catch (err) {
        logger.warn(
          { sessionId, storedAgentId: resumeAgentId, err: (err as Error).message },
          'cursor-agent: resume failed, will create fresh agent'
        );
      }
    }
    if (!agent) {
      logger.info({ sessionId }, 'cursor-agent: creating new agent');
      agent = await Agent.create(agentOptions);
      await persistAgentId?.(agent.agentId);
    }
    return agent;
  }

  async _sessionAgentOptions(
    session: AgentSessionRow,
    turnModel: { model?: string | null; modelParams?: unknown } = {},
    agentConfigId?: number | null,
    agent?: AgentRow | null
  ) {
    const baguetteRulesDir = await this._prepareGlobalRulesDir(session, agent);
    const pluginDirs = await this._getPluginDirs(session);
    return this.buildAgentOptions(session, {
      dirs: [baguetteRulesDir, ...pluginDirs].filter((d): d is string => Boolean(d)),
      model: turnModel.model ?? null,
      modelParams: turnModel.modelParams ?? null,
      agentConfigId,
      agent,
    });
  }

  async _sendWithBusyRetry(
    agent: SDKAgent,
    session: AgentSessionRow,
    userText: string,
    sendOptions: Record<string, unknown> = {}
  ): Promise<Run> {
    const cwd = resolveDataDirRelativePath(session.session_path) || '';
    const store = await this.openSessionStore(session);
    try {
      return await agent.send(userText, sendOptions as never);
    } catch (err) {
      const isActiveRunError =
        err instanceof AgentBusyError ||
        (err as Error)?.message?.includes('already has active run');
      if (!isActiveRunError) throw err;
      const { items } = await Agent.listRuns(agent.agentId, { cwd, store });
      const stale = items.find((r) => r.status === 'running');
      if (stale) await stale.cancel();
      return agent.send(userText, sendOptions as never);
    }
  }

  /**
   * Create/resume a Cursor agent, send one prompt, and stream until the run ends.
   * Session chat adds follow-up runs and usage on top; review uses this directly.
   */
  async runTurn({
    session,
    userText,
    agentOptions,
    writer,
    resumeAgentId,
    persistAgentId,
    persistStatus,
    onStatus,
    onUsage,
    sendOptions = {},
    activeKey,
    abortController,
  }: {
    session: AgentSessionRow;
    userText: string;
    agentOptions: AgentOptions;
    /** Stream writer used to persist typed messages for this turn. */
    writer: MessageStreamWriter;
    resumeAgentId?: string | null;
    persistAgentId?: (agentId: string) => Promise<unknown> | unknown;
    persistStatus?: (text: string) => Promise<void>;
    onStatus?: (sdkMsg: unknown) => Promise<{ break: boolean; finishedOk?: boolean } | void>;
    onUsage?: (sdkMsg: unknown) => void;
    sendOptions?: Record<string, unknown>;
    activeKey?: string | number;
    abortController?: AbortController;
  }): Promise<{ outcome: 'completed' | 'failed' | 'stopped'; agent?: SDKAgent; run?: Run }> {
    const key = activeKey ?? session.id;
    const controller = abortController ?? new AbortController();
    const sessionState: CursorSessionState = {
      isProcessing: true,
      userId: session.user_id,
      currentRun: null,
      abortController: controller,
    };
    this._activeSessions.set(key, sessionState);
    let outcome: 'completed' | 'failed' | 'stopped' = 'failed';
    try {
      const agent = await this.createOrResumeAgent(session, {
        agentOptions,
        resumeAgentId,
        persistAgentId,
      });
      const run = await this._sendWithBusyRetry(agent, session, userText, sendOptions);
      sessionState.currentRun = run;
      const turnUsage = emptyTurnUsage() as TurnUsage;
      const { allFinishedOk } = await this._streamRunChainWithFollowUps(
        session,
        agent,
        run,
        turnUsage,
        { model: session.model },
        {
          activeKey: key,
          channel: 'chat',
          writer,
          abortSignal: controller.signal,
          onUsage,
          onStatus,
        },
        (nextRun) => {
          sessionState.currentRun = nextRun;
        }
      );
      outcome = allFinishedOk ? 'completed' : 'failed';
      return { outcome, agent, run };
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        logger.error(
          { sessionId: session.id, err: (err as Error).message },
          'Cursor session stream error'
        );
        try {
          await persistStatus?.((err as Error).message);
        } catch {
          // ignore secondary errors
        }
        this.app.service('sessions').emit('app:error', {
          sessionId: session.id,
          message: (err as Error).message,
          user_id: session.user_id,
        });
        outcome = 'failed';
      } else {
        outcome = 'stopped';
      }
      return { outcome };
    } finally {
      this._activeSessions.delete(key);
    }
  }

  async stopTurn(activeKey: string | number): Promise<void> {
    const session = this._activeSessions.get(activeKey);
    if (!session) return;
    // Flag must land before the cancel: the terminal-status handler uses it to tell
    // a deliberate stop from a remote/platform CANCELLED (which must bubble as an error).
    session.stopRequested = true;
    try {
      session.abortController?.abort();
      await session.currentRun?.cancel();
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

    const sessionState: CursorSessionState = {
      isProcessing: true,
      userId,
      agentId: agent.id,
      currentRun: null,
      writer: null,
      turnId,
      channel,
      turnAgentConfigId: null,
    };
    this._activeSessions.set(activeKey, sessionState);
    const turnUsage = emptyTurnUsage() as TurnUsage;
    let awaitingUser = false;
    try {
      // Required turn context, resolved here so failures follow the turn's error path:
      // model and agent config come from the message row (params required on Cursor).
      const turnModel = requireTurnModelFromRow(row, { sdk: 'cursor' });
      const turnAgentConfigId = requireAgentConfigId(row.agent_config_id);
      const writer =
        turnId != null
          ? createMessageStreamWriter(this.app, {
              sessionId,
              userId,
              turnId,
              agentId: agent.id,
              channel,
              sessionPath: session.session_path,
              agentType: 'cursor',
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
      const resumeAgentId = agent.cursor_agent_id;
      const reviewExtras =
        channel === 'review'
          ? (getReviewAgentTurn(this.app).peekTurnExtras(sessionId) ?? {})
          : null;
      const agentOptions =
        channel === 'review'
          ? await getReviewAgentTurn(this.app).buildCursorReviewAgentOptions(session, agent, {
              model: turnModel.model,
              modelParams: turnModel.modelParams,
              agentConfigId: turnAgentConfigId,
              extraPrompt: reviewExtras.extraPrompt,
            })
          : await this._sessionAgentOptions(session, turnModel, turnAgentConfigId, agent);
      const cursorAgent = await this.createOrResumeAgent(session, {
        agentOptions,
        resumeAgentId,
        persistAgentId: (cursorId) =>
          patchAgentInternal(this.app, agent.id, { cursor_agent_id: cursorId }, userId),
      });
      const userText = extractUserTextFromUserPayload(parsed);
      const sendOptions: Record<string, unknown> = {};
      if (session.plan_mode) {
        sendOptions.mode = 'plan';
      }

      const run = await this._sendWithBusyRetry(cursorAgent, session, userText, sendOptions);
      sessionState.currentRun = run;

      const { allFinishedOk } = await this._streamRunChainWithFollowUps(
        session,
        cursorAgent,
        run,
        turnUsage,
        turnModel,
        { activeKey, channel, writer },
        (nextRun) => {
          sessionState.currentRun = nextRun;
        }
      );

      awaitingUser = Boolean(sessionState.endTurnAwaitingUser);

      if (allFinishedOk) {
        turnFinishedOk = true;
        await this.app
          .service('sessions')
          .recordCursorUsage(session, turnUsage, {
            turnModel,
            patchSessionCost: true,
            agentConfigId: sessionState.turnAgentConfigId,
            agentId: agent.id,
          })
          .catch((err) =>
            logger.warn(
              { sessionId, err: (err as Error).message },
              'cursor-agent: failed to record turn usage'
            )
          );
        if (!awaitingUser) {
          if (channel === 'review') {
            await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'completed', {
              sdk: 'cursor',
              turnUsage,
              agent,
              turnModel,
            });
          } else {
            await setAgentTurnTerminal(this.app, agent, userId, 'completed');
          }
        }
      }
    } catch (err) {
      awaitingUser = Boolean(sessionState.endTurnAwaitingUser);
      if ((err as Error).name !== 'AbortError') {
        handleAppError(this.app, err, { userId, sessionId });
        logger.error({ sessionId, err: (err as Error).message }, 'Cursor session stream error');
        try {
          if (channel === 'review') {
            await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'failed', {
              sdk: 'cursor',
            });
            await getReviewAgentTurn(this.app)._persistStatus(session, (err as Error).message);
          } else {
            await setAgentTurnTerminal(this.app, agent, userId, 'failed');
            await this._persistStatusMessage(
              sessionId,
              userId,
              (err as Error).message,
              session,
              channel,
              agent.id,
              turnId
            );
          }
        } catch {
          // ignore secondary errors
        }
        this.app
          .service('sessions')
          .emit('app:error', { sessionId, message: (err as Error).message, user_id: userId });
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
          'cursor-agent: failed to send queued message'
        );
      }
    }
  }

  /**
   * Stream one run to completion. Returns { finishedOk, hasBackgroundTask, sawTerminalBreak }.
   * Terminal ERROR/CANCELLED/EXPIRED statuses and silent stream ends mark the turn failed and
   * persist a status message; real failures also emit `app:error` so the UI bubbles them up
   * (a bare CANCELLED with no message killed session 922 turn 10 silently, "Service unavailable"
   * only visible on Cursor's side). Only a user-initiated stop (stopTurn → stopRequested) stays
   * quiet, and CANCELLED after a turn-ending Baguette tool (plan / questions) is expected.
   * FINISHED is left for the caller to handle (so follow-up runs can be chained first).
   */
  async _streamOneRun(
    session: AgentSessionRow,
    run: Run,
    turnUsage: TurnUsage = emptyTurnUsage() as TurnUsage,
    turnModel: { model?: string | null; modelParams?: unknown } = {},
    streamOpts: StreamOneRunOpts = {}
  ): Promise<StreamOneRunResult> {
    const sessionId = session.id;
    const userId = session.user_id;
    const channel: MessageChannel = streamOpts.channel ?? 'chat';
    const activeKey = streamOpts.activeKey ?? session.id;
    const sessionState = this._activeSessions.get(activeKey);
    const writer =
      streamOpts.writer ??
      sessionState?.writer ??
      createMessageStreamWriter(this.app, {
        sessionId,
        userId: session.user_id,
        turnId: sessionState?.turnId ?? 1,
        agentId: sessionState?.agentId ?? 0,
        channel: sessionState?.channel ?? 'chat',
        sessionPath: session.session_path,
        agentType: 'cursor',
        model: turnModel.model ?? '',
        modelParams: turnModel.modelParams,
        agentConfigId: sessionState?.turnAgentConfigId,
      });

    const { abortSignal, onUsage: onUsageOverride, onStatus: onStatusOverride } = streamOpts;

    const streamed = await processCursorRunStream(run, {
      writer,
      abortSignal,
      onUsage: (sdkMsg: SDKUsageMessage) => {
        onUsageOverride?.(sdkMsg);
        addTokenUsage(turnUsage, sdkMsg.usage);
        turnUsage.model = run.model?.id ?? turnModel.model ?? turnUsage.model;
      },
      onStatus: async (sdkMsg: SDKStatusMessage) => {
        const custom = await onStatusOverride?.(sdkMsg);
        if (custom?.break) return custom;

        const { status } = sdkMsg;
        if (status === 'FINISHED') {
          return { break: true, finishedOk: true };
        }
        if (status === 'ERROR' || status === 'CANCELLED' || status === 'EXPIRED') {
          if (status === 'CANCELLED' && sessionState?.endTurnAwaitingUser) {
            return { break: true, finishedOk: true };
          }
          const userStopped = this.isCursorStopRequested(sessionState, abortSignal);
          logger.warn(
            {
              sessionId,
              status,
              agent_id: sdkMsg.agent_id,
              run_id: sdkMsg.run_id,
              sdkMessage: sdkMsg.message,
              user_stopped: userStopped,
            },
            'cursor-agent received terminal status'
          );
          // Session-922 shape: a bare terminal status with no message. The run handle may
          // still carry the real cause (e.g. "Service unavailable") — recover it unless the
          // stop was ours; drain only when the status event itself is silent.
          const sdkDetail = sdkMsg.message || null;
          const detail =
            userStopped || sdkDetail ? sdkDetail : await this._cursorRunFailureDetail(run);
          const surfacing = cursorTerminalStatusSurfacing(status, {
            detail,
            userInitiated: userStopped,
          });
          await this._surfaceCursorTurnFailure(session, sessionId, userId, {
            channel,
            sessionState,
            surfacing,
          });
          // finishedOk stays false even for user stops so the caller's completed-turn
          // bookkeeping (usage/queued follow-ups) is skipped after a deliberate stop.
          return { break: true, finishedOk: false };
        }
      },
    });

    // The stream generator can also drain without any status event (observed after
    // provider-level failures): surface that instead of leaving the agent stuck running.
    if (!streamed.finishedOk && !streamed.sawTerminalBreak && !sessionState?.endTurnAwaitingUser) {
      const userStopped = this.isCursorStopRequested(sessionState, abortSignal);
      if (!userStopped) {
        logger.warn(
          { sessionId, run_id: run.id },
          'cursor-agent: run stream ended without a terminal status'
        );
        const detail = await this._cursorRunFailureDetail(run);
        await this._surfaceCursorTurnFailure(session, sessionId, userId, {
          channel,
          sessionState,
          surfacing: {
            statusText: cursorSilentEndStatusText(detail),
            isFailure: true,
          },
        });
      }
    }

    return streamed;
  }

  /** True when the user (not Cursor's side) ended this run. */
  isCursorStopRequested(
    sessionState: CursorSessionState | null | undefined,
    abortSignal?: AbortSignal
  ): boolean {
    return sessionState?.stopRequested === true || abortSignal?.aborted === true;
  }

  /**
   * Terminal failure bookkeeping shared by the terminal-status and silent-end paths:
   * persist the status row (with the turn id so it lands in the failed turn), mark the
   * agent failed unless the stop was deliberate, and emit `app:error` for real failures.
   */
  private async _surfaceCursorTurnFailure(
    session: AgentSessionRow,
    sessionId: number,
    userId: number,
    {
      channel,
      sessionState,
      surfacing,
    }: {
      channel: MessageChannel;
      sessionState: CursorSessionState | undefined;
      surfacing: { statusText: string; isFailure: boolean };
    }
  ): Promise<void> {
    if (channel === 'review') {
      await getReviewAgentTurn(this.app)._persistStatus(session, surfacing.statusText);
      if (surfacing.isFailure) {
        await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'failed', {
          sdk: 'cursor',
        });
      }
    } else {
      const agentId = sessionState?.agentId;
      const agentRow = agentId != null ? await getAgentById(this.app.get('db'), agentId) : null;
      if (surfacing.isFailure && agentRow) {
        await setAgentTurnTerminal(this.app, agentRow, userId, 'failed');
      }
      await this._persistStatusMessage(
        sessionId,
        userId,
        surfacing.statusText,
        session,
        channel,
        agentId,
        sessionState?.turnId ?? null
      );
    }
    if (surfacing.isFailure) {
      this.app
        .service('sessions')
        .emit('app:error', { sessionId, message: surfacing.statusText, user_id: userId });
    }
  }

  /**
   * Best-effort failure detail from the run's terminal result. The terminal status event
   * usually carries nothing (session 922: bare CANCELLED while Cursor reported
   * "Service unavailable" on its side); `run.wait()` is the SDK's documented source for
   * `RunResult.error`. Timeboxed so a wedged backend cannot stall the failure path.
   */
  private async _cursorRunFailureDetail(run: Run | null | undefined): Promise<string | null> {
    if (!run) return null;
    // Synchronous handle state first: populated once the handle is terminal, no round trip.
    const synced = this.syncCursorRunErrorMessage(run);
    if (synced) return synced;
    // wait() throws UnsupportedRunOperationError while the run is still running — which is
    // exactly the silent-end state — and that SDK error text must never become failure copy.
    if (run.supports && !run.supports('wait')) return null;
    if (typeof run.wait !== 'function') return null;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000));
    try {
      const result = (await Promise.race([run.wait(), timeout])) as RunResult | null;
      if (!result || result.status !== 'error') return null;
      const message = result.error?.message;
      return message ? message : null;
    } catch (err) {
      if (err instanceof UnsupportedRunOperationError) return null;
      if ((err as Error).name === 'AbortError') return null;
      const message = (err as Error).message;
      return message ? message : null;
    }
  }

  /** Terminal error message already known on the Run handle (`error` getter), if any. */
  private syncCursorRunErrorMessage(run: Run): string | null {
    const error = run.error;
    if (!error) return null;
    const message = error.message;
    return message ? message : null;
  }

  /**
   * Stream the initial Cursor run and any follow-up runs scheduled for background subagents.
   */
  async _streamRunChainWithFollowUps(
    session: AgentSessionRow,
    agent: SDKAgent,
    firstRun: Run,
    turnUsage: TurnUsage,
    turnModel: { model?: string | null; modelParams?: unknown },
    streamOpts: StreamOneRunOpts,
    onFollowUpRun?: (run: Run) => void
  ): Promise<{ allFinishedOk: boolean }> {
    const sessionId = session.id;
    let lastCompletedRunId = firstRun.id;
    const first = await this._streamOneRun(session, firstRun, turnUsage, turnModel, streamOpts);

    if (!first.finishedOk) return { allFinishedOk: false };

    let hasBackgroundTask = first.hasBackgroundTask;

    const MAX_FOLLOW_UPS = 10;
    for (let i = 0; hasBackgroundTask && i < MAX_FOLLOW_UPS; i++) {
      const followUpRun = await this._findFollowUpRun(session, agent, lastCompletedRunId);
      if (!followUpRun) break;

      logger.info(
        { sessionId, followUpRunId: followUpRun.id, followUpIndex: i },
        'cursor-agent: processing follow-up run from background task'
      );
      onFollowUpRun?.(followUpRun);
      const next = await this._streamOneRun(session, followUpRun, turnUsage, turnModel, streamOpts);
      if (!next.finishedOk) return { allFinishedOk: false };
      lastCompletedRunId = followUpRun.id;
      hasBackgroundTask = next.hasBackgroundTask;
    }

    return { allFinishedOk: true };
  }

  /**
   * Polls Agent.listRuns for a follow-up run created by a background task.
   * Returns the run if found within the idle timeout, null otherwise.
   */
  async _findFollowUpRun(
    session: AgentSessionRow,
    agent: SDKAgent,
    completedRunId: string
  ): Promise<Run | null> {
    const cwd = resolveDataDirRelativePath(session.session_path) || '';
    const store = await this.openSessionStore(session);
    const INTERVAL_MS = 2000;
    const MAX_IDLE_POLLS = 30;

    let idlePolls = 0;
    while (idlePolls < MAX_IDLE_POLLS) {
      if (idlePolls > 0) await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
      try {
        const { items } = await Agent.listRuns(agent.agentId, { cwd, store });
        const followUp = items.find((r) => r.status === 'running' && r.id !== completedRunId);
        if (followUp) return followUp;
        idlePolls += 1;
      } catch (err) {
        logger.warn(
          { sessionId: session.id, err: (err as Error).message },
          'cursor-agent: error checking for follow-up run'
        );
        return null;
      }
    }
    return null;
  }

  async _persistStatusMessage(
    sessionId: number,
    userId: number,
    statusText: string,
    _session: AgentSessionRow,
    channel: MessageChannel = 'chat',
    builderAgentId?: number | null,
    turnId?: number | null
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
        ...(turnId != null ? { turn_id: turnId } : {}),
        type: 'system',
        subtype: 'status',
        message_json: JSON.stringify(payload),
        ...sessionMessageIdentity(agentRow, {
          agent_sdk: 'cursor',
        }),
      },
      { provider: undefined, user: { id: userId } }
    );
  }

  async stopSession(sessionId: number) {
    await this.stopTurn(sessionId);
  }

  getActiveSession(sessionId: string | number): CursorSessionState | null {
    return this._activeSessions.get(sessionId) ?? null;
  }

  async get(id: number) {
    return this.getActiveSession(id);
  }

  async generateSessionMetadata(
    initialPrompt: string,
    shortId = '',
    user: { id?: number } | null = null,
    repo: { id?: number | null } | null = null,
    session: Pick<AgentSessionRow, 'model' | 'model_params' | 'agent_config_id'> | null = null
  ): Promise<{ label: string; branchName: string }> {
    const fallbackBranch = `task-${shortId}`;
    const prompt = `Generate metadata for a coding task. Output ONLY a JSON object with no markdown or explanation:
- "label": very short label (max 50 chars) summarizing the task
- "branch": short kebab-case git branch name suffixed with "-${shortId}" (e.g. "fix-auth-token-${shortId}"), max 60 chars

Task: ${initialPrompt}`;

    let label = '';
    let branchName = fallbackBranch;

    const apiKey = user?.id
      ? await this.loadAgentConfigApiKey(user.id, session?.agent_config_id)
      : undefined;
    // Generate the label/branch with the session's selected model (and its variant params)
    // so the metadata matches the agent that will actually run the task. Sessions created
    // without an explicit model fall back to a cheap one so provisioning stays fast.
    const modelId = session?.model || CURSOR_CHEAP_MODEL_ID;
    const modelParams = this.parseModelParams(session?.model_params);
    let repoFullName: string | null = null;
    if (repo?.id) {
      const repoRow = await (this.app.get('db') as DbLike)('repos').where({ id: repo.id }).first();
      repoFullName = (repoRow?.full_name as string) ?? null;
    }
    const homeSession = {
      short_id: shortId,
      repo_full_name: repoFullName,
      session_path: null,
    } as AgentSessionRow;

    let collectedText = '';

    const store = await SqliteLocalAgentStore.open({
      workspaceRef: cursorWorkspaceRef(homeSession),
      stateRoot: cursorSdkStateRoot(homeSession) ?? join(DATA_DIR, 'cursor-sdk-store'),
    });
    const agent = await Agent.create({
      apiKey,
      model: modelParams?.length ? { id: modelId, params: modelParams } : { id: modelId },
      local: {
        settingSources: [],
        store,
      },
    } as AgentOptions);

    const run = await agent.send(prompt);

    for await (const sdkMsg of run.stream()) {
      if (sdkMsg.type === 'assistant') {
        const content = (
          sdkMsg as { message?: { content?: Array<{ type?: string; text?: string }> } }
        ).message?.content;
        for (const block of content ?? []) {
          if (block.type === 'text') collectedText += block.text ?? '';
        }
      }
      if (
        sdkMsg.type === 'status' &&
        (sdkMsg as { status?: string }).status &&
        ['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED'].includes(
          (sdkMsg as { status?: string }).status as string
        )
      ) {
        break;
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
    return Boolean(agent?.cursor_agent_id);
  }

  usesCompactionBeforeLoopRepeat(): boolean {
    return false;
  }
}

export function registerCursorAgentService(app: AgentApp, path = CURSOR_AGENT_SERVICE_PATH) {
  const service = new CursorAgentService();
  service.setup(app);
  app.use(path, service, {
    methods: [
      'stopSession',
      'stopTurn',
      'runTurn',
      'buildAgentOptions',
      'writeAlwaysApplyRule',
      'writePromptRule',
      'createOrResumeAgent',
      'generateSessionMetadata',
      'openSessionStore',
      'disposeSessionStore',
      'prepareTiedSessionLoopCompaction',
      'handleMessageCreated',
      'isInterruptedSessionResumable',
    ],
  });
  // Internal-only service: drives the agent SDK and must never be reachable over the
  // HTTP transport (see PUBLIC_SERVICES for the declarative external allow-list).
  app.service(path).hooks({ before: { all: [disableExternal] } });
  registerAgentSdk(app, {
    key: CURSOR_AGENT_SDK_KEY,
    label: CURSOR_AGENT_SDK_LABEL,
    servicePath: path,
  });
}
