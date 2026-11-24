import {
  query,
  type CanUseTool,
  type Options as ClaudeSdkOptions,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  type SettingSource,
} from '@anthropic-ai/claude-agent-sdk';
import { ClaudeUsageLimitGuard } from './usage-limit.js';
import { getLastResultTotals } from './usage-totals.js';
import { allowsOverage, usageLimitStatusText } from '../../lib/usage-limit.js';
import type { ClaudeUsageLimitHit } from './sdk-turn.ts';
import logger from '../../logger.js';
import { METADATA_TIMEOUT_MS } from '../../services/session-metadata.js';
import { remoteHasNewCommits } from '../../services/github.js';
import { getGithubToken, getAllowedCommandsFromUser } from '../../services/agent-settings.js';
import { attachAppErrorHandler, handleAppError } from '../../lib/app-error-handler.js';
import { applyClaudeAgentModelEnv, getClaudeEnv } from './env.js';
import { buildBaguetteToolList, buildReviewerAgentTools } from '../../services/mcp/server.js';
import { loadEnabledMcpServersForSession } from '../../services/user-mcp-runtime.js';
import { loadConfiguredSlackApps } from '../../services/mcp/lib/slack.js';
import { toolListToClaudeMcpServer } from './adapt-tools.js';
import { claudeSdkSubagentDenyResult } from './reject-sdk-subagent.js';
import { createMessageChannel } from '../../services/message-channel.js';
import { buildSystemPromptAppend } from '../../services/session-prompt.js';
import { resolveDataDirRelativePath } from '../../config.js';
import { agentWorktreeCwd } from '../../services/subagent-worktree.js';
import { SDK_QUERY_CLOSED_MESSAGE } from './claude-agent-sdk-constants.js';
import { normalizeUserMessageForAgentSdk } from '../../../shared/user-message-content.js';
import { isBaguetteUserMessage, requireTurnModelFromRow } from '../../../shared/turn-model.js';
import {
  applyClaudeModelParamsToQueryInstance,
  claudeSdkOptionsFromModelParams,
} from './sdk-options.js';
import { getReviewAgentTurn, reviewTurnKey } from '../../services/review-agent-turn.js';
import { requireAgentConfigId } from '../../lib/usage-snapshot.js';
import { createMessageStreamWriter } from '../../services/message-writer-factory.ts';
import {
  assertAgentTurnCredentials,
  prepareAgentTurnStart,
} from '../../services/agent-turn-prelude.js';
import { sessionMessageIdentity } from '../../services/feathers/message-create-fields.js';
import { claudeResultErrorText } from './mapping.ts';
import { processClaudeQueryStream, type ClaudeStreamTurnOutcome } from './sdk-turn.ts';
import type { MessageStreamWriter } from '../../../shared/message-stream-writer.ts';
import type { UserMessagePayload } from '../../../shared/session-messages.ts';
import type {
  AgentApp,
  AgentRow,
  AgentSessionRow,
  DbLike,
  MessageChannel,
  MessageRowLike,
  TiedSessionLoopCompactionArgs,
} from '../../services/feathers/agent-service-types.ts';
import { claudeTiedSessionLoopCompaction } from './loop-compaction.ts';
import { CLAUDE_AGENT_SDK_KEY, CLAUDE_AGENT_SDK_LABEL, CLAUDE_AGENT_SERVICE_PATH } from './meta.js';
import { recordClaudeTurnUsage } from './record-turn-usage.js';
import {
  handleAgentMessageCreated,
  isAgentSessionResumable,
  registerInternalAgentService,
} from '../../services/agent-service-lifecycle.ts';
import { getSdkPlugin } from '../registry.js';
import {
  getAgentById,
  getPrimaryBuilderAgent,
  getReviewerAgent,
} from '../../services/agents-db.js';
import { patchAgentInternal } from '../../services/feathers/agents.service.js';
import {
  setAgentActiveTurnId,
  setAgentTurnRunning,
  setAgentTurnTerminal,
} from '../../services/agent-turn-patch.js';

type TurnOutcome = ClaudeStreamTurnOutcome;

const CLAUDE_SILENT_END_TEXT =
  'Agent ended the turn without completing. Send your message again to continue.';

function claudeTurnFailureError(opts: {
  lastStreamError: string | null;
  lastResult: SDKMessage | null;
  silentQueryEnd: boolean;
}): string | null {
  if (opts.lastStreamError) return opts.lastStreamError;
  if (opts.lastResult) return claudeResultErrorText(opts.lastResult as SDKResultMessage);
  if (opts.silentQueryEnd) return CLAUDE_SILENT_END_TEXT;
  return null;
}

/** Push/end handle feeding user messages into an open SDK query. */
type ChannelHandle = {
  push(message: SDKUserMessage): void;
  end(): void;
};

/** Mutable state for one open SDK query (chat or review channel). */
type ClaudeAgentState = {
  sessionId: number;
  agentId: number;
  userId: number;
  channel: ChannelHandle;
  queryInstance: Query;
  abortController: AbortController;
  repoFullName?: string | null;
  branch?: string | null;
  absoluteSessionPath?: string | null;
  repoId?: number | null;
  token?: string | null;
  claudeSessionId?: string | null;
  streamWriter?: MessageStreamWriter | null;
  turnChannel?: MessageChannel;
  activeKey?: string | number;
  /** Agent config for this turn (snapshot at turn start; used when recording usage). */
  turnAgentConfigId?: number | null;
  /** Turn model snapshot from the message row (used when recording usage). */
  turnModel?: { model: string; modelParams?: unknown };
  /** Set when a turn-ending Baguette MCP tool ends the turn early for user input. */
  endTurnAwaitingUser?: boolean;
};

type RunTurnOpts = {
  sessionId: number;
  userId: number;
  prompt?: unknown;
  queryOptions?: ClaudeSdkOptions;
  persistMessage?: (message: SDKMessage) => Promise<void>;
  onInitSessionId?: (id: string) => Promise<void>;
  onResult?: (message: SDKMessage) => Promise<void>;
  onStreamError?: (err: Error) => Promise<void>;
  trackBackgroundTasks?: boolean;
  activeKey?: string | number;
  extraState?: Partial<ClaudeAgentState>;
  connectionClosedHint?: string;
};

type ConsumeQueryOpts = {
  streamWriter?: MessageStreamWriter | null;
  persistMessage?: (message: SDKMessage) => Promise<void>;
  onInitSessionId?: (id: string) => Promise<void>;
  onResult?: (message: SDKMessage) => Promise<void>;
  onStreamError?: (err: Error) => Promise<void>;
  trackBackgroundTasks?: boolean;
  activeKey?: string | number;
  connectionClosedHint?: string;
};

type StartAgentLoopOpts = {
  model?: string | null;
  modelParams?: unknown;
  channel?: MessageChannel;
  activeKey?: string | number;
  writer?: MessageStreamWriter | null;
  turnAgentConfigId?: number | null;
};

type SessionOrId = number | string | { id: number };

function commandsToAllowedTools(commands: string[]): string[] {
  return commands.map((cmd) => `Bash(${cmd}*)`);
}

/** Claude tool names allowed on a review-tab turn (not used by other SDKs). */
const REVIEWER_ALLOWED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'LS',
  ...commandsToAllowedTools(getAllowedCommandsFromUser()),
  'mcp__baguette__ListSkills',
  'mcp__baguette__ReadSkill',
  'mcp__baguette__CurrentSessionInfo',
  'mcp__baguette__CreateIssue',
  'mcp__baguette__ListIssues',
  'mcp__baguette__ReadIssue',
  'mcp__baguette__UpdateIssue',
  'mcp__baguette__CloseIssue',
];

function toSdkUserMessage(prompt: unknown): SDKUserMessage {
  if (prompt && typeof prompt === 'object') return prompt as SDKUserMessage;
  return {
    type: 'user',
    message: { role: 'user', content: (prompt as string) ?? '' },
    parent_tool_use_id: null,
  };
}

// ─── ClaudeAgentService class ─────────────────────────────────────────────────

function toClaudeSdkUserPayload(parsedStorage: unknown): unknown {
  let forSdk: Record<string, unknown> = parsedStorage as Record<string, unknown>;
  if (
    isBaguetteUserMessage(parsedStorage) &&
    typeof (parsedStorage as UserMessagePayload).content === 'string'
  ) {
    const baguette = parsedStorage as UserMessagePayload;
    forSdk = {
      type: 'user',
      source: 'baguette',
      title: baguette.title,
      message: { role: 'user', content: baguette.content },
    };
  } else if (typeof (parsedStorage as { content?: unknown }).content === 'string') {
    forSdk = {
      type: 'user',
      message: { role: 'user', content: (parsedStorage as { content: string }).content },
    };
  } else if (Array.isArray((parsedStorage as { content?: unknown }).content)) {
    forSdk = {
      type: 'user',
      message: {
        role: 'user',
        content: (parsedStorage as { content: unknown[] }).content,
      },
    };
  }
  return normalizeUserMessageForAgentSdk(forSdk);
}

export class ClaudeAgentService {
  app!: AgentApp;
  private _activeSessions: Map<string | number, ClaudeAgentState>;
  private _resumePromises: Map<string | number, Promise<ClaudeAgentState>>;
  private _handlingMessageIds = new Set<number>();

  constructor() {
    this._activeSessions = new Map();
    this._resumePromises = new Map();
  }

  setup(app: AgentApp, _path?: string) {
    this.app = app;
  }

  /**
   * SDK query options for a Claude turn. Callers override MCP, prompt, tools, resume, etc.
   */
  async buildQueryOptions(
    sessionRow: AgentSessionRow,
    {
      systemPrompt,
      mcpServer,
      allowedTools,
      permissionMode = 'acceptEdits',
      settingSources = ['project'],
      resume,
      model,
      modelParams,
      canUseTool,
      plugins,
      claudeEnv,
      agent,
    }: {
      systemPrompt?: string;
      mcpServer?: ClaudeSdkOptions['mcpServers'];
      agent?: AgentRow | null;
      allowedTools?: string[];
      permissionMode?: PermissionMode;
      settingSources?: SettingSource[];
      resume?: string;
      model?: string | null;
      modelParams?: unknown;
      canUseTool?: CanUseTool;
      plugins?: ClaudeSdkOptions['plugins'];
      /** Prebuilt subprocess env from the turn's agent config (sessions.getClaudeEnv). */
      claudeEnv?: Record<string, string>;
    } = {}
  ): Promise<ClaudeSdkOptions> {
    if (!model) throw new Error('Model is required to run this turn');
    if (!claudeEnv) throw new Error('Agent configuration is required to run this turn');
    const resolvedModel = model;
    const cwd =
      agentWorktreeCwd(sessionRow, agent) ||
      sessionRow.absolute_session_path ||
      resolveDataDirRelativePath(sessionRow.session_path) ||
      '';
    const resolvedMcp =
      mcpServer ??
      (getSdkPlugin(CLAUDE_AGENT_SDK_KEY)?.adaptTools ?? toolListToClaudeMcpServer)(
        await buildBaguetteToolList(sessionRow, this.app, {
          slackApps: await loadConfiguredSlackApps(this.app),
          agent,
        })
      );
    const paramOptions = claudeSdkOptionsFromModelParams(modelParams);
    const userMcp = await loadEnabledMcpServersForSession(this.app, sessionRow);
    return {
      cwd,
      env: applyClaudeAgentModelEnv(claudeEnv, resolvedModel),
      resume,
      model: resolvedModel,
      ...paramOptions,
      tools: { type: 'preset', preset: 'claude_code' },
      settingSources,
      mcpServers: { ...userMcp, baguette: resolvedMcp },
      permissionMode,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: systemPrompt ?? '',
      },
      ...(canUseTool ? { canUseTool } : {}),
      ...(allowedTools?.length ? { allowedTools } : {}),
      ...(plugins?.length ? { plugins } : {}),
    } as ClaudeSdkOptions;
  }

  async _buildSessionQueryOptions(
    sessionRow: AgentSessionRow,
    {
      claudeEnv,
      canUseTool,
      allowedTools,
      model,
      modelParams,
      agent,
    }: {
      claudeEnv: Record<string, string>;
      canUseTool?: CanUseTool;
      allowedTools?: string[];
      model?: string | null;
      modelParams?: unknown;
      agent?: AgentRow | null;
    }
  ): Promise<ClaudeSdkOptions> {
    let pluginRows: Array<Record<string, unknown>> = [];
    if (sessionRow.plugins) {
      try {
        const pluginIds: unknown = JSON.parse(sessionRow.plugins);
        if (Array.isArray(pluginIds) && pluginIds.length > 0) {
          pluginRows = await (this.app.get('db') as DbLike)('plugins').whereIn('id', pluginIds);
        }
      } catch {
        // malformed plugins JSON — ignore
      }
    }
    const plugins = (pluginRows || []).map((p) => ({
      type: 'local' as const,
      path: resolveDataDirRelativePath(p.local_path as string) ?? '',
    }));
    const systemPrompt = await buildSystemPromptAppend(sessionRow, {
      agent,
      db: this.app.get('db') as never,
      app: this.app,
      agentSdk: CLAUDE_AGENT_SDK_KEY,
    });
    return this.buildQueryOptions(sessionRow, {
      claudeEnv,
      systemPrompt,
      canUseTool,
      allowedTools,
      permissionMode: 'acceptEdits',
      plugins,
      model,
      modelParams,
      ...(agent?.claude_session_id ? { resume: agent.claude_session_id } : {}),
      agent,
    });
  }

  _openQuery({
    sessionId,
    agentId,
    userId,
    queryOptions,
    extraState = {},
    activeKey,
  }: {
    sessionId: number;
    agentId: number;
    userId: number;
    queryOptions: ClaudeSdkOptions;
    extraState?: Partial<ClaudeAgentState>;
    activeKey?: string | number;
  }): ClaudeAgentState {
    const channel = createMessageChannel() as unknown as ChannelHandle;
    const abortController = new AbortController();
    const queryInstance = query({
      prompt: channel as unknown as AsyncIterable<SDKUserMessage>,
      options: { ...queryOptions, abortController },
    });
    const state: ClaudeAgentState = {
      sessionId,
      agentId,
      userId,
      channel,
      queryInstance,
      abortController,
      ...extraState,
    };
    this._activeSessions.set(activeKey ?? sessionId, state);
    return state;
  }

  /**
   * Run one Claude query turn: open the SDK, push a prompt, consume the stream, dispose.
   * Used by session chat (via _startAgentLoop) and session review.
   */
  async runTurn(opts: RunTurnOpts): Promise<{ turnComplete: boolean; outcome: TurnOutcome }> {
    const key = opts.activeKey ?? opts.sessionId;
    const agentId = opts.extraState?.agentId;
    if (agentId == null) throw new Error('agentId is required to run a Claude turn');
    const state = this._openQuery({
      sessionId: opts.sessionId,
      agentId,
      userId: opts.userId,
      queryOptions: opts.queryOptions ?? {},
      extraState: opts.extraState,
      activeKey: key,
    });
    if (opts.prompt != null) {
      state.channel.push(toSdkUserMessage(opts.prompt));
    }
    return await this._consumeQuery(state, {
      persistMessage: opts.persistMessage,
      onInitSessionId: opts.onInitSessionId,
      onResult: opts.onResult,
      onStreamError: opts.onStreamError,
      trackBackgroundTasks: opts.trackBackgroundTasks,
      activeKey: key,
      connectionClosedHint: opts.connectionClosedHint,
    });
  }

  async stopTurn(activeKey: string | number): Promise<void> {
    await this._disposeActiveSession(activeKey);
  }

  async handleMessageCreated(row: MessageRowLike): Promise<void> {
    await handleAgentMessageCreated({
      app: this.app,
      row,
      expectedSdk: CLAUDE_AGENT_SDK_KEY,
      handlingMessageIds: this._handlingMessageIds,
      loadSession: (sessionId) =>
        this.app.service('sessions').get(sessionId) as Promise<AgentSessionRow | null>,
      getActiveTurn: (key) => this.getActiveSession(key) ?? undefined,
      onActiveTurnMessage: ({ parsed: parsedStorage, active }) => {
        active?.channel.push(toClaudeSdkUserPayload(parsedStorage));
      },
      onStartTurn: async ({
        session,
        agent,
        parsed: parsedStorage,
        channel,
        isReview,
        activeKey,
      }) => {
        const sessionId = session.id;
        const parsed = toClaudeSdkUserPayload(parsedStorage);

        if (row.turn_id != null) {
          await setAgentActiveTurnId(this.app, agent, session.user_id, row.turn_id);
        }

        const turnModel = requireTurnModelFromRow(row, {
          sdk: CLAUDE_AGENT_SDK_KEY,
          requiresModelParamsOnTurn:
            getSdkPlugin(CLAUDE_AGENT_SDK_KEY)?.requiresModelParamsOnTurn === true,
        });
        const { model, modelParams } = turnModel;
        const turnAgentConfigId = requireAgentConfigId(row.agent_config_id);

        try {
          await assertAgentTurnCredentials(this.app, {
            userId: session.user_id,
            agentSdk: CLAUDE_AGENT_SDK_KEY,
            agentConfigId: turnAgentConfigId,
          });
        } catch (err) {
          if ((err as { name?: string })?.name !== 'Forbidden') {
            throw err;
          }
          const errorMessage = (err as Error).message;
          if (isReview) {
            await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'failed', {
              sdk: 'claude',
              error_message: errorMessage,
            });
            return;
          }
          await setAgentTurnTerminal(this.app, agent, session.user_id, 'failed', {
            error_message: errorMessage,
          });
          this.app
            .service('sessions')
            .emit('app:error', { sessionId, message: errorMessage, user_id: session.user_id });
          return;
        }

        // Never start a turn on a used-up plan window: providers would keep serving it on paid
        // overage. Applies to every agent of the session (builder, subagents, reviewer).
        const blocked = await this.app
          .service('sessions')
          .checkUsageLimitGate(sessionId, agent.id, { agentConfigId: turnAgentConfigId });
        if (blocked) {
          if (isReview) {
            await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'failed', {
              sdk: 'claude',
              error_message: usageLimitStatusText({
                label: 'Claude',
                reason: blocked.reason,
                action: 'stop',
                resetAtMs: blocked.reset_at_ms,
              }),
            });
            return;
          }
          await setAgentTurnTerminal(this.app, agent, session.user_id, 'stopped');
          await this.app.service('sessions').onUsageLimit(sessionId, agent.id, {
            ...blocked,
            label: 'Claude',
          });
          return;
        }
        await prepareAgentTurnStart(this.app, session, agent, {
          channel,
          agentSdk: CLAUDE_AGENT_SDK_KEY,
        });
        const writer =
          row.turn_id != null
            ? createMessageStreamWriter(this.app, {
                sessionId,
                userId: session.user_id,
                turnId: row.turn_id,
                agentId: agent.id,
                channel,
                sessionPath: session.session_path,
                agentType: 'claude',
                model: model ?? session.model ?? '',
                modelParams,
                agentConfigId: turnAgentConfigId,
              })
            : null;

        let agentSession: ClaudeAgentState;
        const resumeId = agent.claude_session_id;
        if (resumeId) {
          const resumed = await this.ensureActiveSession(session, agent, {
            model,
            modelParams,
            channel,
            activeKey,
            writer,
            turnAgentConfigId,
          });
          if (!resumed) return;
          agentSession = resumed;
        } else {
          agentSession = await this.createAgentSession(session, agent, {
            model,
            modelParams,
            channel,
            activeKey,
            writer,
            turnAgentConfigId,
          });
        }

        agentSession.channel.push(parsed);
      },
    });
  }

  async createAgentSession(
    session: AgentSessionRow,
    agent: AgentRow,
    {
      model,
      modelParams,
      channel = 'chat',
      activeKey,
      writer,
      turnAgentConfigId,
    }: StartAgentLoopOpts = {}
  ): Promise<ClaudeAgentState> {
    const sessionState = await this._startAgentLoop(session, agent, {
      model,
      modelParams,
      channel,
      activeKey,
      writer,
      turnAgentConfigId,
    });

    if (channel !== 'review') {
      await setAgentTurnRunning(this.app, agent, session.user_id);
      await this.app.service('sessions').onTurnStart(session.id);
    }
    return sessionState;
  }

  /** @param sessionOrId - session row or session id */
  getActiveSession(sessionOrId: SessionOrId): ClaudeAgentState | undefined {
    const id =
      typeof sessionOrId === 'object' && sessionOrId !== null ? sessionOrId.id : sessionOrId;
    return this._activeSessions.get(id);
  }

  /**
   * Tear down SDK handles and drop the session from `_activeSessions`.
   * Idempotent: no-op if already removed (e.g. after `stopSession`, end of a turn’s `result`, or a prior dispose).
   *
   * **Why we drop the session from memory after each completed turn:** the SDK query holds transports,
   * MCP state, and subprocess-related work. Removing it from `_activeSessions` once a `result` arrives
   * avoids unbounded growth when many sessions stay idle; the next user message calls `ensureActiveSession`
   * and resumes via `claude_session_id` on a fresh query.
   *
   * **Why `close()` is deferred:** see {@link ClaudeAgentService._closeQueryInstanceSafe} — short settlement
   * before `close()`. Expected SDK rejects from {@link SDK_QUERY_CLOSED_MESSAGE} are ignored globally in
   * `server/index.js`.
   *
   * **Order:** stop feeding the channel and abort first so the CLI winds down; clear approval waiters and
   * remove from `_activeSessions` so a new query can start for this session while we wait to `close()` the
   * old instance on the next tick.
   */
  /**
   * Close the SDK query. Brief pre-close delays let MCP/control work drain after abort. In-flight
   * promises may still reject with {@link SDK_QUERY_CLOSED_MESSAGE}; those are treated as benign in
   * `process.on('unhandledRejection')` in `server/index.js`.
   */
  async _closeQueryInstanceSafe(sessionId: number, queryInstance: Query): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      queryInstance.close();
    } catch (err) {
      logger.warn(
        { sessionId, err: (err as Error).message },
        'claude-agent session dispose cleanup'
      );
    }
  }

  async _disposeActiveSession(activeKey: string | number): Promise<void> {
    const session = this._activeSessions.get(activeKey);
    if (!session) return;
    if (session.streamWriter) {
      try {
        await session.streamWriter.finish();
      } catch (err) {
        logger.warn(
          { sessionId: session.sessionId, err: err.message },
          'claude-agent stream writer finish failed'
        );
      }
    }
    try {
      // No further user turns on this query; abort signals the SDK side to stop.
      session.channel.end();
      session.abortController.abort();
    } catch (err) {
      logger.warn(
        { sessionId: session.sessionId, err: (err as Error).message },
        'claude-agent session dispose cleanup'
      );
    }
    this._activeSessions.delete(activeKey);
    await this._closeQueryInstanceSafe(session.sessionId, session.queryInstance);
  }

  createCanUseTool() {
    return async (toolName: string, input: Record<string, unknown>): Promise<PermissionResult> => {
      if (toolName === 'ExitPlanMode') {
        return {
          behavior: 'allow',
          updatedInput: input,
          message:
            'Plan saved for user review in chat. The turn can complete; the user will message when ready to execute or refine.',
        } as PermissionResult;
      }

      if (toolName === 'AskUserQuestion') {
        return {
          behavior: 'deny',
          message: 'Questions presented to the user inline. They will reply with their answers.',
        };
      }

      const sdkSubagentDeny = claudeSdkSubagentDenyResult(toolName);
      if (sdkSubagentDeny) return sdkSubagentDeny;

      return { behavior: 'allow', updatedInput: input };
    };
  }

  async injectBaguetteMessage(
    sessionState: ClaudeAgentState,
    { title, content }: { title: string; content: string }
  ) {
    const { sessionId } = sessionState;
    const app = this.app;
    const db = this.app.get('db') as DbLike;
    const payload: UserMessagePayload & { subtype: string } = {
      type: 'user',
      source: 'baguette',
      title,
      content,
      subtype: 'baguette',
    };

    const channel = sessionState.turnChannel ?? 'chat';
    let agentRow;
    if (channel === 'review') {
      agentRow = await getReviewerAgent(db, sessionId);
    } else if (sessionState.agentId != null) {
      agentRow = await getAgentById(db, sessionState.agentId);
    } else {
      agentRow = await getPrimaryBuilderAgent(db, sessionId);
    }
    if (!agentRow) return;
    const identity = sessionMessageIdentity(agentRow, { agent_sdk: 'claude' });

    await app.service('messages').create({
      session_id: sessionId,
      type: 'user',
      subtype: 'baguette',
      message_json: JSON.stringify(payload),
      ...identity,
    });
  }

  /**
   * Shared setup for both createSession and resumeSession: builds the
   * channel, query instance, session state, and kicks off the
   * message-processing loop.
   */
  async _startAgentLoop(
    sessionRow: AgentSessionRow,
    agent: AgentRow,
    {
      model,
      modelParams,
      channel = 'chat',
      activeKey,
      writer,
      turnAgentConfigId,
    }: StartAgentLoopOpts = {}
  ): Promise<ClaudeAgentState> {
    if (!model) throw new Error('Model is required to run this turn');
    const turnConfigId = requireAgentConfigId(turnAgentConfigId);
    const user = await this.app.service('users').get(sessionRow.user_id, {});
    const sessionId = sessionRow.id;
    const canUseTool = this.createCanUseTool();
    const allowedTools = commandsToAllowedTools(getAllowedCommandsFromUser());
    const resolvedActiveKey = activeKey ?? sessionId;
    // Env from the turn's agent config row — the config id was resolved at dispatch
    // from the message row snapshot and is required to be present.
    const claudeEnv = await getClaudeEnv(this.app, sessionRow.user_id, turnConfigId);
    let queryOptions: ClaudeSdkOptions;
    if (channel === 'review') {
      const extras = getReviewAgentTurn(this.app).peekTurnExtras(sessionId) ?? {};
      const ctx = await getReviewAgentTurn(this.app).prepareReviewContext(sessionRow, agent, {
        extraPrompt: extras.extraPrompt,
        model,
        modelParams,
        agentSdk: CLAUDE_AGENT_SDK_KEY,
      });
      const plugin = getSdkPlugin(CLAUDE_AGENT_SDK_KEY);
      const reviewerTools = (plugin?.adaptTools ?? toolListToClaudeMcpServer)(
        buildReviewerAgentTools(sessionRow, this.app, ctx.turnAgent)
      );
      const hasStored = plugin?.hasStoredSession;
      let resume: string | undefined;
      if (typeof hasStored === 'function') {
        resume = hasStored(agent) ? (agent.claude_session_id ?? undefined) : undefined;
      } else {
        resume = agent.claude_session_id ?? undefined;
      }
      queryOptions = await this.buildQueryOptions(sessionRow, {
        systemPrompt: ctx.systemPrompt,
        mcpServer: reviewerTools,
        allowedTools: REVIEWER_ALLOWED_TOOLS,
        settingSources: [],
        ...(resume ? { resume } : {}),
        model,
        modelParams,
        permissionMode: 'acceptEdits',
        claudeEnv,
        canUseTool,
      });
    } else {
      queryOptions = await this._buildSessionQueryOptions(sessionRow, {
        claudeEnv,
        canUseTool,
        allowedTools,
        model,
        modelParams,
        agent,
      });
    }

    const absoluteSessionPath = resolveDataDirRelativePath(sessionRow.session_path) || '';
    const sessionState = this._openQuery({
      sessionId,
      agentId: agent.id,
      userId: sessionRow.user_id,
      queryOptions,
      extraState: {
        repoFullName: sessionRow.repo_full_name,
        branch: sessionRow.base_branch,
        absoluteSessionPath,
        repoId: sessionRow.repo_id,
        token: getGithubToken(user),
        ...(agent.claude_session_id ? { claudeSessionId: agent.claude_session_id } : {}),
        streamWriter: writer ?? null,
        turnChannel: channel,
        activeKey: resolvedActiveKey,
        turnAgentConfigId: turnConfigId,
        turnModel: { model, modelParams },
      },
      activeKey: resolvedActiveKey,
    });

    attachAppErrorHandler(this.app, this.processMessages(sessionState), {
      userId: sessionRow.user_id,
      sessionId,
    }).catch((err: Error) => {
      logger.error({ sessionId }, err.message);
    });

    if (modelParams != null) {
      void applyClaudeModelParamsToQueryInstance(sessionState.queryInstance, modelParams).catch(
        (err: Error) => {
          logger.warn(
            { sessionId, err: err.message },
            'claude-agent: failed to apply model params to query'
          );
        }
      );
    }

    return sessionState;
  }

  async resumeSession(
    session: AgentSessionRow,
    agent: AgentRow,
    { model, modelParams, channel, activeKey, writer, turnAgentConfigId }: StartAgentLoopOpts = {}
  ): Promise<ClaudeAgentState> {
    if (!agent.claude_session_id) throw new Error('No Claude session to resume');

    const sessionState = await this._startAgentLoop(session, agent, {
      model,
      modelParams,
      channel,
      activeKey,
      writer,
      turnAgentConfigId,
    });

    logger.info(
      { sessionId: session.id, claudeSessionId: agent.claude_session_id },
      'Resumed session'
    );

    return sessionState;
  }

  async ensureActiveSession(
    sessionOrId: SessionOrId,
    agent: AgentRow,
    { model, modelParams, channel, activeKey, writer, turnAgentConfigId }: StartAgentLoopOpts = {}
  ): Promise<ClaudeAgentState | null> {
    const sessionRow: AgentSessionRow | undefined =
      typeof sessionOrId === 'object' && sessionOrId !== null
        ? (sessionOrId as AgentSessionRow)
        : ((await (this.app.get('db') as DbLike)('sessions').where({ id: sessionOrId }).first()) as
            AgentSessionRow | undefined);
    if (!sessionRow) return null;

    const sessionId = sessionRow.id;
    const key = activeKey ?? sessionId;
    const existing = this._activeSessions.get(key);
    if (existing) return existing;

    if (!this._resumePromises.has(key)) {
      const promise = this.resumeSession(sessionRow, agent, {
        model,
        modelParams,
        channel,
        activeKey: key,
        writer,
        turnAgentConfigId,
      }).finally(() => {
        this._resumePromises.delete(key);
      });
      this._resumePromises.set(key, promise);
    }

    return this._resumePromises.get(key) ?? null;
  }

  /**
   * Incremental Claude tokens and estimated cost for one finished turn's final
   * SDK `result`. Running token totals live on the Claude plugin (`usage-totals.js`).
   */
  async recordTurnUsage(
    session: AgentSessionRow,
    result: SDKMessage,
    opts: {
      turnModel?: { model: string; modelParams?: unknown };
      totalsKey?: string | number;
      patchSessionCost?: boolean;
      agentConfigId?: number | null;
      agentId?: number;
    } = {}
  ): Promise<number> {
    return recordClaudeTurnUsage(this.app, session, result, opts);
  }

  /** Paid overage spent this turn counts against the session's `usage_limit` in later turns. */
  async _recordOverageSpend(
    sessionState: ClaudeAgentState,
    guard: ClaudeUsageLimitGuard | null
  ): Promise<void> {
    if (!guard || guard.spentUsd <= 0) return;
    const db = this.app.get('db') as DbLike;
    await db('sessions')
      .where({ id: sessionState.sessionId })
      .increment('usage_limit_spent', guard.spentUsd)
      .catch((err: Error) =>
        logger.warn(
          { sessionId: sessionState.sessionId, err: err.message },
          'claude-agent: failed to record overage spend'
        )
      );
  }

  /**
   * A synthetic `result` for a turn cut before its own: absolute per-model totals (what the
   * last recorded result left in the running totals, plus the tokens seen since), so the
   * usual delta recording yields exactly the cut turn's usage.
   */
  _partialResult(
    sessionState: ClaudeAgentState,
    partial: Record<string, Record<string, number>> | null | undefined
  ): SDKMessage | null {
    if (!partial) return null;
    const prev = getLastResultTotals(sessionState.sessionId).models as Record<
      string,
      Record<string, number>
    >;
    const modelUsage: Record<string, Record<string, number>> = {};
    for (const [model, used] of Object.entries(partial)) {
      const before = prev?.[model] ?? {};
      modelUsage[model] = Object.fromEntries(
        Object.entries(used).map(([field, n]) => [field, (before[field] ?? 0) + n])
      );
    }
    return { type: 'result', modelUsage } as unknown as SDKMessage;
  }

  /** Usage for a turn cut short by a limit, so the spend before the cut is still recorded. */
  async _recordLimitTurnUsage(sessionState: ClaudeAgentState, result: SDKMessage): Promise<void> {
    const db = this.app.get('db') as DbLike;
    const session = (await db('sessions').where({ id: sessionState.sessionId }).first()) as
      AgentSessionRow | undefined;
    const agent = (await getAgentById(db as never, sessionState.agentId)) as AgentRow | undefined;
    if (!session || !agent) return;
    await this._recordClaudeTurnUsage(
      session,
      agent,
      result,
      sessionState.turnChannel ?? 'chat',
      sessionState.turnAgentConfigId,
      sessionState.turnModel
    );
  }

  /** Persist one turn's Claude usage from the final SDK `result` for this consume pass. */
  async _recordClaudeTurnUsage(
    session: AgentSessionRow,
    agent: AgentRow,
    result: SDKMessage,
    channel: MessageChannel,
    turnAgentConfigId?: number | null,
    turnModel?: { model: string; modelParams?: unknown }
  ): Promise<void> {
    const isReview = channel === 'review';
    await this.recordTurnUsage(session, result, {
      turnModel,
      totalsKey: isReview ? reviewTurnKey(agent.id) : undefined,
      patchSessionCost: true,
      agentConfigId: turnAgentConfigId,
      agentId: agent.id,
    }).catch((err) =>
      logger.warn(
        { sessionId: session.id, err: (err as Error).message },
        'claude-agent: failed to record turn usage'
      )
    );
  }

  async processMessages(sessionState: ClaudeAgentState): Promise<void> {
    const { sessionId, userId } = sessionState;
    const db = this.app.get('db') as DbLike;
    const activeKey = sessionState.activeKey ?? sessionId;
    const isReview = sessionState.turnChannel === 'review';
    const { turnComplete, streamFailed, outcome, lastResult, lastStreamError, usageLimit } =
      await this._consumeQuery(sessionState, {
        streamWriter: sessionState.streamWriter ?? null,
        persistMessage: (message) => this.persistMessage(sessionState, message),
        onInitSessionId: async (id) => {
          await patchAgentInternal(
            this.app,
            sessionState.agentId,
            { claude_session_id: id },
            userId
          );
          sessionState.claudeSessionId = id;
        },
        onStreamError: async (err: Error) => {
          if (!isReview) return; // Chat status is patched once after the stream ends below.
          const session = (await db('sessions').where({ id: sessionId }).first()) as
            AgentSessionRow | undefined;
          if (!session) return;
          const userFacing =
            err.message === SDK_QUERY_CLOSED_MESSAGE
              ? 'Agent connection closed before the response finished. Try sending your message again.'
              : err.message;
          await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'failed', {
            sdk: 'claude',
            error_message: userFacing,
          });
        },
        trackBackgroundTasks: true,
        activeKey,
      });

    const awaitingUser = Boolean(sessionState.endTurnAwaitingUser);

    // A subscription limit (or the session's usage limit) ended the turn: persist the notice,
    // stop the agent, and — when the session asks for it — schedule the resume.
    if (usageLimit && !isReview) {
      if (lastResult) {
        await this._recordLimitTurnUsage(sessionState, lastResult).catch((err) =>
          logger.warn(
            { sessionId, err: (err as Error).message },
            'claude-agent: failed to record limit-turn usage'
          )
        );
      }
      await setAgentTurnTerminal(this.app, { id: sessionState.agentId }, userId, 'stopped');
      await this.app.service('sessions').onUsageLimit(sessionId, sessionState.agentId, {
        label: 'Claude',
        sdk: 'claude',
        reason: usageLimit.reason,
        reset_at_ms: usageLimit.resetAtMs,
      });
      return;
    }

    // A turn can also end with a failed `result` message (quota, max turns, budget) without
    // the stream throwing — the mirror of the Cursor terminal-status gap. Bubble it to the
    // user: the turn_result row renders inline, but the toast/banner needs `app:error`.
    // outcome === 'failed' also skips deliberate aborts (outcome 'stopped').
    if (turnComplete && !streamFailed && !awaitingUser && outcome === 'failed') {
      const failedText = claudeResultErrorText(lastResult as SDKResultMessage);
      logger.warn(
        { sessionId, subtype: (lastResult as { subtype?: string })?.subtype },
        'Claude turn ended with a failed result'
      );
      this.app.service('sessions').emit('app:error', {
        sessionId,
        message: failedText,
        user_id: userId,
      });
    }

    // The SDK iterator can also drain without any result and without throwing (mirror of
    // the Cursor silent stream end): with no verdict the agent used to stay 'running'
    // forever and the user learned nothing. Surface it and end the turn as failed.
    // outcome === 'failed' here means "no result and no throw"; aborts land on 'stopped'.
    const silentQueryEnd = !turnComplete && !streamFailed && outcome === 'failed';
    if (silentQueryEnd && !awaitingUser) {
      logger.warn({ sessionId }, 'Claude query ended without a result message');
      this.app.service('sessions').emit('app:error', {
        sessionId,
        message: CLAUDE_SILENT_END_TEXT,
        user_id: userId,
      });
    }

    if (lastResult) {
      const session = (await db('sessions').where({ id: sessionId }).first()) as
        AgentSessionRow | undefined;
      const agent = (await getAgentById(db as never, sessionState.agentId)) as AgentRow | undefined;
      if (session && agent) {
        await this._recordClaudeTurnUsage(
          session,
          agent,
          lastResult,
          sessionState.turnChannel ?? 'chat',
          sessionState.turnAgentConfigId,
          sessionState.turnModel
        );
      }
    }

    const failureError = claudeTurnFailureError({
      lastStreamError,
      lastResult,
      silentQueryEnd,
    });

    if (isReview && (turnComplete || silentQueryEnd) && !awaitingUser) {
      const session = (await db('sessions').where({ id: sessionId }).first()) as
        AgentSessionRow | undefined;
      if (session) {
        if (outcome === 'completed') {
          await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'completed', {
            sdk: 'claude',
          });
        } else {
          await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'failed', {
            sdk: 'claude',
            error_message: failureError,
          });
        }
      }
    }

    // One terminal status for the whole turn (including background-task auto-resume).
    // Usage is recorded from the last SDK result; queued follow-ups start after this.
    if (!isReview) {
      const turnEnded = turnComplete || streamFailed || silentQueryEnd;
      if (awaitingUser) {
        await setAgentTurnTerminal(this.app, { id: sessionState.agentId }, userId, 'approval');
      } else if (turnEnded && outcome === 'completed') {
        await setAgentTurnTerminal(this.app, { id: sessionState.agentId }, userId, 'completed');
      } else if (turnEnded) {
        await setAgentTurnTerminal(this.app, { id: sessionState.agentId }, userId, 'failed', {
          error_message: failureError,
        });
      } else if (outcome === 'stopped') {
        await setAgentTurnTerminal(this.app, { id: sessionState.agentId }, userId, 'stopped');
      }
    }

    if (!isReview) {
      const shouldCompleteTurn = awaitingUser || (turnComplete && outcome === 'completed');
      if (shouldCompleteTurn) {
        try {
          await this.app.service('sessions').onTurnComplete(sessionId, sessionState.agentId);
        } catch (err) {
          logger.warn({ sessionId, err: (err as Error).message }, 'Failed to send queued message');
        }
      }
    }
  }

  /**
   * Consume an open Claude query until the turn ends (result, abort, or stream error).
   *
   * Delegates the SDK event loop to `processClaudeQueryStream`; this method
   * owns the Feathers-layer concerns (logging, app:error emission, query
   * dispose) that wrap the stream.
   */
  async _consumeQuery(
    sessionState: ClaudeAgentState,
    {
      streamWriter,
      persistMessage,
      onInitSessionId,
      onResult,
      onStreamError,
      trackBackgroundTasks = false,
      activeKey,
      connectionClosedHint = 'Agent connection closed before the response finished. Try sending your message again.',
    }: ConsumeQueryOpts
  ): Promise<{
    turnComplete: boolean;
    streamFailed: boolean;
    outcome: TurnOutcome;
    lastResult: SDKMessage | null;
    lastStreamError: string | null;
    usageLimit: ClaudeUsageLimitHit | null;
  }> {
    const { queryInstance, sessionId, userId } = sessionState;
    const key = activeKey ?? sessionId;

    let streamFailed = false;
    let lastStreamError: string | null = null;
    const usageGuard = await this._createUsageGuard(sessionState);
    const result = await processClaudeQueryStream(queryInstance, {
      writer: streamWriter,
      usageGuard,
      usageCheck: usageGuard ? () => this._checkPlanLimits(sessionState) : null,
      persistMessage,
      onInitSessionId,
      onResult,
      trackBackgroundTasks,
      onStreamError: async (err) => {
        // Service-level error wiring: log, emit app:error, route through
        // onStreamError. The failed turn_result is persisted by setAgentTurnTerminal.
        if (err.name !== 'AbortError') {
          handleAppError(this.app, err, { userId, sessionId });
          logger.error({ sessionId }, 'Session stream error');
          logger.error(err, 'Session stream error');
          const userFacing =
            err.message === SDK_QUERY_CLOSED_MESSAGE ? connectionClosedHint : err.message;
          lastStreamError = userFacing;
          this.app
            .service('sessions')
            .emit('app:error', { sessionId, message: userFacing, user_id: userId });
          streamFailed = true;
        }
        await onStreamError?.(err);
      },
    }).finally(async () => {
      try {
        await this._disposeActiveSession(key);
      } catch (disposeErr) {
        logger.warn(
          { sessionId, err: (disposeErr as Error)?.message },
          'claude-agent dispose failed'
        );
      }
    });

    await this._recordOverageSpend(sessionState, usageGuard);
    // A turn cut before its own `result` is recorded from the tokens seen so far.
    const lastResult =
      result.lastResult ??
      (result.usageLimit
        ? this._partialResult(sessionState, usageGuard?.partialModelUsageSinceResult())
        : null);

    return {
      turnComplete: result.turnComplete,
      streamFailed: result.streamFailed || streamFailed,
      outcome: result.outcome,
      lastResult,
      lastStreamError,
      usageLimit: result.usageLimit,
    };
  }

  /**
   * Guard that ends a chat turn on a subscription limit (see `usage-limit.js`). Review turns
   * are not guarded: they have no resume path, so they keep the old rejected-limit behavior.
   */
  async _createUsageGuard(sessionState: ClaudeAgentState): Promise<ClaudeUsageLimitGuard | null> {
    if (sessionState.turnChannel === 'review') return null;
    try {
      const db = this.app.get('db') as DbLike;
      const row = (await db('sessions').where({ id: sessionState.sessionId }).first()) as
        | {
            usage_limit_action?: string | null;
            usage_limit?: number | null;
            usage_limit_spent?: number | null;
          }
        | undefined;
      return new ClaudeUsageLimitGuard({
        overage: allowsOverage(row?.usage_limit_action),
        usageLimitUsd: row?.usage_limit ?? null,
        priorSpentUsd: row?.usage_limit_spent ?? 0,
      });
    } catch (err) {
      // The guard is optional: without it the turn just runs unguarded.
      logger.warn(
        { sessionId: sessionState.sessionId, err: (err as Error).message },
        'claude-agent: usage guard unavailable'
      );
      return null;
    }
  }

  /**
   * Re-read the plan limits mid-turn (see `ClaudeUsageLimitGuard.checkpointDue`). A full
   * session/weekly window ends the turn for `stop` / `wait` sessions — including turns run by
   * subagents — instead of letting the provider roll it onto paid overage.
   */
  async _checkPlanLimits(sessionState: ClaudeAgentState): Promise<ClaudeUsageLimitHit | null> {
    const blocked = await this.app
      .service('sessions')
      .checkUsageLimitGate(sessionState.sessionId, sessionState.agentId, {
        agentConfigId: sessionState.turnAgentConfigId ?? null,
      });
    return blocked ? { reason: blocked.reason, resetAtMs: blocked.reset_at_ms } : null;
  }

  async sendMessage(sessionId: number, content: string): Promise<void> {
    const db = this.app.get('db') as DbLike;
    const sessionRow = (await db('sessions').where({ id: sessionId }).first()) as
      AgentSessionRow | undefined;
    if (!sessionRow) throw new Error('Session not found');
    const builder = (await getPrimaryBuilderAgent(db, sessionId)) as AgentRow | undefined;
    if (!builder) throw new Error('Builder agent not found');
    const session = await this.ensureActiveSession(sessionId, builder);

    await setAgentTurnRunning(this.app, builder, sessionRow.user_id);
    await this.app.service('sessions').onTurnStart(sessionId);

    const absoluteSessionPath = resolveDataDirRelativePath(sessionRow.session_path as string);
    const user = await this.app.service('users').get(sessionRow.user_id, {});
    const token = session?.token ?? getGithubToken(user);
    const repoFullName = (session?.repoFullName ?? sessionRow.repo_full_name) as string;
    if (sessionRow.remote_branch && absoluteSessionPath && token) {
      try {
        const hasNew = await remoteHasNewCommits(
          absoluteSessionPath,
          sessionRow.remote_branch as string,
          token,
          repoFullName
        );
        if (hasNew) {
          await this.injectBaguetteMessage(
            { sessionId },
            {
              title: 'Syncing with remote',
              content:
                'There are new commits on the remote branch. Please pull the latest changes, ' +
                'resolve any merge conflicts, and commit the merge before we proceed.',
            }
          );
        }
      } catch (err) {
        logger.error(err, 'Remote check error (non-fatal)');
      }
    }

    await this.app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content }),
        ...sessionMessageIdentity(builder),
      },
      { user: { id: sessionRow.user_id } }
    );

    session?.channel.push(toSdkUserMessage(content));
  }

  async syncSessionSettingsFromPatch(
    sessionId: number,
    _sessionRow: AgentSessionRow
  ): Promise<void> {
    const session = this.getActiveSession(sessionId);
    if (!session?.queryInstance) return;
    void (async () => {
      const builder = await getPrimaryBuilderAgent(this.app.get('db'), sessionId);
      if (!builder) return;
      session.queryInstance.setModel((builder.model as string) ?? undefined);
      await applyClaudeModelParamsToQueryInstance(session.queryInstance, builder.model_params);
    })().catch((err: Error) => {
      logger.warn(
        { sessionId, err: err.message },
        'claude-agent: failed to sync model params from session patch'
      );
    });
  }

  async stopSession(sessionId: number): Promise<void> {
    await this._disposeActiveSession(sessionId);
  }

  /**
   * One-shot completion: send a prompt, return the raw response text.
   * Must resolve within METADATA_TIMEOUT_MS and clean up its own CLI subprocess on
   * timeout — callers treat '' as "no completion" and fall back to defaults.
   */
  async completeText(
    prompt: string,
    opts: {
      userId?: number | null;
      agentConfigId?: number | null;
      model?: string | null;
    } = {}
  ): Promise<string> {
    // Run with the requested model so the completion matches the agent that will
    // actually use it. Calls without an explicit model fall back to the cheap alias
    // so provisioning stays fast.
    const model = opts.model || 'haiku';
    // Credentials follow the config that selected the model (the user's utility
    // default, else the session's builder config) so gateway models resolve correctly.
    const env = applyClaudeAgentModelEnv(
      await getClaudeEnv(this.app, opts.userId ?? 0, opts.agentConfigId ?? null),
      opts.model ?? null
    );
    const q = query({ prompt, options: { model, env } });
    let text = '';
    const consume = (async () => {
      for await (const message of q) {
        const msg = message as SDKMessage & {
          subtype?: string;
          is_error?: boolean;
          result?: string;
        };
        if (msg.type === 'result' && msg.subtype === 'success' && !msg.is_error) {
          text = (msg.result || '').trim();
        }
      }
    })();

    // The CLI retries failed API calls up to 10 times with exponential backoff; a bad
    // credential or model can stall completions for minutes. Provisioning must not wait
    // on that — fail fast and let the caller fall back to defaults.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        consume,
        new Promise<void>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Completion timed out')), METADATA_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      try {
        q.close(); // end the CLI subprocess after timeout or completion
      } catch {
        /* already closed */
      }
      consume.catch(() => {}); // late failures after timeout/close are non-fatal
    }

    return text;
  }

  async isInterruptedSessionResumable(
    session: AgentSessionRow,
    opts: { channel?: MessageChannel; agent?: AgentRow } = {}
  ): Promise<boolean> {
    return isAgentSessionResumable(this.app, session, 'claude_session_id', opts);
  }

  usesCompactionBeforeLoopRepeat(): boolean {
    return true;
  }

  async persistMessage(sessionState: ClaudeAgentState, message: SDKMessage): Promise<void> {
    const { sessionId, userId } = sessionState;
    const app = this.app;
    const msg = message as SDKMessage & {
      subtype?: string;
      uuid?: string;
      total_cost_usd?: number | null;
    };

    if (msg.type === 'system' && msg.subtype === 'thinking_tokens') {
      return;
    }

    const agentRow = (await getAgentById(this.app.get('db'), sessionState.agentId)) as
      AgentRow | undefined;
    if (!agentRow) return;

    const identity = sessionMessageIdentity(agentRow, {
      agent_sdk: 'claude',
      agent_config_id: sessionState.turnAgentConfigId,
      model: sessionState.turnModel?.model,
      model_params: sessionState.turnModel?.modelParams,
    });

    await app.service('messages').create(
      {
        session_id: sessionId,
        type: msg.type,
        subtype: msg.subtype ?? null,
        uuid: msg.uuid ?? null,
        message_json: JSON.stringify(msg),
        total_cost_usd: msg.type === 'result' ? (msg.total_cost_usd ?? null) : null,
        ...identity,
      },
      { provider: undefined, user: { id: userId } }
    );
  }

  async prepareTiedSessionLoopCompaction(args: TiedSessionLoopCompactionArgs): Promise<void> {
    await claudeTiedSessionLoopCompaction(this.app, args);
  }

  // Required by @feathersjs/express to recognise this as a Feathers service
  // rather than Express middleware.
  async get(id: number) {
    return this.getActiveSession(id) ?? null;
  }
}

export function registerClaudeAgentService(app: AgentApp, path = CLAUDE_AGENT_SERVICE_PATH) {
  registerInternalAgentService(app, {
    service: new ClaudeAgentService(),
    path,
    methods: [
      'createAgentSession',
      'resumeSession',
      'ensureActiveSession',
      'sendMessage',
      'stopSession',
      'stopTurn',
      'runTurn',
      'buildQueryOptions',
      'syncSessionSettingsFromPatch',
      'prepareTiedSessionLoopCompaction',
      'handleMessageCreated',
      'completeText',
      'isInterruptedSessionResumable',
    ],
    key: CLAUDE_AGENT_SDK_KEY,
    label: CLAUDE_AGENT_SDK_LABEL,
  });
}
