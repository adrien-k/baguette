import {
  query,
  type CanUseTool,
  type Options as ClaudeSdkOptions,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SettingSource,
} from '@anthropic-ai/claude-agent-sdk';
import logger from '../../logger.js';
import { remoteHasNewCommits } from '../github.js';
import { getGithubToken, getAllowedCommandsFromUser } from '../agent-settings.js';
import { attachAppErrorHandler, handleAppError } from '../../lib/app-error-handler.js';
import { applyClaudeAgentModelEnv, getClaudeEnv } from '../session-env.js';
import { buildBaguetteMcpServer } from '../baguette-mcp-server.js';
import { createMessageChannel } from '../message-channel.js';
import { buildSystemPromptAppend } from '../session-prompt.js';
import { getEffectiveAgentPrompt } from '../effective-user-prompts.js';
import { resolveDataDirRelativePath } from '../../config.js';
import { SDK_QUERY_CLOSED_MESSAGE } from '../../claude-agent-sdk-constants.js';
import { normalizeUserMessageForAgentSdk } from '../../../shared/user-message-content.js';
import { isBaguetteUserMessage, requireTurnModelFromRow } from '../../../shared/turn-model.js';
import {
  applyClaudeModelParamsToQueryInstance,
  claudeSdkOptionsFromModelParams,
} from '../../../shared/claude-model-params.js';
import { getReviewAgentTurn, reviewTurnKey } from '../review-agent-turn.js';
import {
  requireAgentConfigIdForSession,
  requireAgentConfigIdForTurn,
} from '../../lib/usage-agent-config.js';
import {
  isDispatchableUserMessage,
  parseUserRow,
  rejectTurnMismatch,
} from '../agent-message-dispatch.js';
import { createMessageStreamWriter } from '../message-writer-factory.ts';
import { sessionMessageIdentity } from './message-create-fields.js';
import {
  processClaudeQueryStream,
  type ClaudeStreamTurnOutcome,
} from '../claude/claude-sdk-turn.ts';
import type { MessageStreamWriter } from '../../../shared/message-stream-writer.ts';
import type { SystemMessagePayload, UserMessagePayload } from '../../../shared/session-messages.ts';
import type {
  AgentApp,
  AgentRow,
  AgentSessionRow,
  DbLike,
  MessageChannel,
  MessageRowLike,
  TiedSessionLoopCompactionArgs,
} from './agent-service-types.ts';
import { claudeTiedSessionLoopCompaction } from './loop-compaction.ts';
import {
  CLAUDE_AGENT_SDK_KEY,
  CLAUDE_AGENT_SDK_LABEL,
  CLAUDE_AGENT_SERVICE_PATH,
} from '../agent-sdk-meta.js';
import { registerAgentSdk } from './agent-configs.service.js';
import {
  getAgentById,
  getPrimaryBuilderAgent,
  getReviewerAgent,
  resolveAgentRowForMessage,
} from '../agents-db.js';
import { patchAgentInternal } from './agents.service.js';
import {
  setAgentActiveTurnId,
  setAgentTurnRunning,
  setAgentTurnTerminal,
} from '../agent-turn-patch.js';

type TurnOutcome = ClaudeStreamTurnOutcome;

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
  sessionSettings?: { permissionMode: PermissionMode };
  claudeSessionId?: string | null;
  streamWriter?: MessageStreamWriter | null;
  turnChannel?: MessageChannel;
  activeKey?: string | number;
  /** Agent config for this turn (snapshot at turn start; used when recording usage). */
  turnAgentConfigId?: number | null;
  /** Set when a turn-ending Baguette MCP tool ends the turn early for user input. */
  endTurnAwaitingUser?: boolean;
};

type RunTurnOpts = {
  sessionId: number;
  userId: number;
  prompt?: unknown;
  queryOptions?: ClaudeSdkOptions;
  persistMessage?: (message: SDKMessage) => Promise<void>;
  persistStatus?: (text: string) => Promise<void>;
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
  persistStatus?: (text: string) => Promise<void>;
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

/** Hard cap on session metadata (label/branch) generation — provisioning must not stall on CLI API retries. */
const METADATA_TIMEOUT_MS = 30_000;

function claudeSdkPermissionMode(sessionRow: AgentSessionRow): 'plan' | 'acceptEdits' {
  return sessionRow.plan_mode ? 'plan' : 'acceptEdits';
}

function toSdkUserMessage(prompt: unknown): SDKUserMessage {
  if (prompt && typeof prompt === 'object') return prompt as SDKUserMessage;
  return {
    type: 'user',
    message: { role: 'user', content: (prompt as string) ?? '' },
    parent_tool_use_id: null,
  };
}

// ─── ClaudeAgentService class ─────────────────────────────────────────────────

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
    }: {
      systemPrompt?: string;
      mcpServer?: ClaudeSdkOptions['mcpServers'];
      allowedTools?: string[];
      permissionMode?: PermissionMode;
      settingSources?: SettingSource[];
      resume?: string | boolean;
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
      resolveDataDirRelativePath(sessionRow.session_path) || sessionRow.absolute_session_path || '';
    const resolvedMcp = mcpServer ?? (await buildBaguetteMcpServer(sessionRow, this.app));
    const paramOptions = claudeSdkOptionsFromModelParams(modelParams);
    return {
      cwd,
      env: applyClaudeAgentModelEnv(claudeEnv, resolvedModel),
      resume: resume !== undefined ? resume || undefined : undefined,
      model: resolvedModel,
      ...paramOptions,
      tools: { type: 'preset', preset: 'claude_code' },
      settingSources,
      mcpServers: { baguette: resolvedMcp },
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
    }: {
      claudeEnv: Record<string, string>;
      canUseTool?: CanUseTool;
      allowedTools?: string[];
      model?: string | null;
      modelParams?: unknown;
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
    const agentPrompt = await getEffectiveAgentPrompt(
      this.app,
      sessionRow.user_id,
      sessionRow.repo_id
    );
    const systemPrompt = await buildSystemPromptAppend(sessionRow, { agentPrompt });
    return this.buildQueryOptions(sessionRow, {
      claudeEnv,
      systemPrompt,
      canUseTool,
      allowedTools,
      permissionMode: claudeSdkPermissionMode(sessionRow),
      plugins,
      model,
      modelParams,
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
      persistStatus: opts.persistStatus,
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
    if (row.type !== 'user') return;
    if (row.id != null && this._handlingMessageIds.has(row.id)) return;
    if (row.id != null) this._handlingMessageIds.add(row.id);
    try {
      await this._handleMessageCreatedImpl(row);
    } finally {
      if (row.id != null) this._handlingMessageIds.delete(row.id);
    }
  }

  async _handleMessageCreatedImpl(row: MessageRowLike): Promise<void> {
    const parsedStorage = parseUserRow(row);
    if (!parsedStorage || !isDispatchableUserMessage(parsedStorage)) return;

    const sessionId = row.session_id;
    const session = (await this.app.service('sessions').get(sessionId)) as AgentSessionRow | null;
    if (!session || session.archived_at) return;

    const db = this.app.get('db') as DbLike;
    const agent = (await resolveAgentRowForMessage(db as never, row as never)) as
      AgentRow | undefined;
    if (!agent) return;

    const isReview = agent.agent_type === 'reviewer';
    const channel: MessageChannel = isReview ? 'review' : 'chat';
    const sdk = row.agent_sdk ?? agent.agent_sdk;
    if (sdk !== 'claude') return;

    if (!isReview) {
      if (session.status === 'archiving' || session.status === 'archived') return;
      if (session.repo_full_name && !session.session_path) return;
    }

    const activeKey = isReview ? reviewTurnKey(agent.id) : sessionId;
    const active = this.getActiveSession(activeKey);
    const activeTurnId = agent.active_turn_id;

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
    const parsed = normalizeUserMessageForAgentSdk(forSdk);

    if (active) {
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
      active.channel.push(parsed);
      return;
    }

    if (row.turn_id != null) {
      await setAgentActiveTurnId(this.app, agent, session.user_id, row.turn_id);
    }

    const turnModel = requireTurnModelFromRow(row, { sdk });
    const { model, modelParams } = turnModel;
    const turnAgentConfigId = requireAgentConfigIdForTurn(session, row, channel);
    const writer =
      row.turn_id != null
        ? createMessageStreamWriter(this.app, {
            sessionId,
            userId: session.user_id,
            turnId: row.turn_id,
            channel,
            sessionPath: session.session_path,
            agentType: 'claude',
            model: model ?? session.model ?? '',
            modelParams,
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

  async _persistSessionStatusMessage(sessionId: number, userId: number, statusText: string) {
    const payload: SystemMessagePayload = {
      type: 'system',
      subtype: 'status',
      status: statusText,
    };
    const builder = await getPrimaryBuilderAgent(this.app.get('db'), sessionId);
    if (!builder) return;
    await this.app.service('messages').create(
      {
        session_id: sessionId,
        type: 'system',
        subtype: 'status',
        message_json: JSON.stringify(payload),
        ...sessionMessageIdentity(builder, 'builder'),
      },
      { provider: undefined, user: { id: userId } }
    );
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
    const identity = sessionMessageIdentity(
      agentRow,
      channel === 'review' ? 'reviewer' : 'builder',
      { agent_sdk: 'claude' }
    );

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
    const configFromAgent = agent.agent_config_id != null ? Number(agent.agent_config_id) : null;
    const turnConfigId =
      turnAgentConfigId ?? configFromAgent ?? requireAgentConfigIdForSession(sessionRow, channel);
    const user = await this.app.service('users').get(sessionRow.user_id, {});
    const sessionId = sessionRow.id;
    const sessionSettings = {
      permissionMode: claudeSdkPermissionMode(sessionRow),
    };
    const canUseTool = this.createCanUseTool();
    const allowedTools = commandsToAllowedTools(getAllowedCommandsFromUser());
    const resolvedActiveKey = activeKey ?? sessionId;
    // Env from the turn's agent config row — the config id was resolved at dispatch
    // (message row snapshot, session fallback) and is required to be present.
    const claudeEnv = await getClaudeEnv(this.app, sessionRow.user_id, null, turnConfigId);
    let queryOptions: ClaudeSdkOptions;
    if (channel === 'review') {
      const extras = getReviewAgentTurn(this.app).peekTurnExtras(sessionId) ?? {};
      const resumeId = agent.claude_session_id;
      queryOptions = await getReviewAgentTurn(this.app).buildClaudeQueryOptions(sessionRow, agent, {
        model,
        modelParams,
        claudeEnv,
        continuation: !!resumeId || Boolean(extras.continuation),
        extraPrompt: extras.extraPrompt,
      });
    } else {
      queryOptions = await this._buildSessionQueryOptions(sessionRow, {
        claudeEnv,
        canUseTool,
        allowedTools,
        model,
        modelParams,
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
        sessionSettings,
        ...(agent.claude_session_id ? { claudeSessionId: agent.claude_session_id } : {}),
        streamWriter: writer ?? null,
        turnChannel: channel,
        activeKey: resolvedActiveKey,
        turnAgentConfigId: turnConfigId,
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

  /** Persist one turn's Claude usage from the final SDK `result` for this consume pass. */
  async _recordClaudeTurnUsage(
    session: AgentSessionRow,
    agent: AgentRow,
    result: SDKMessage,
    channel: MessageChannel,
    turnAgentConfigId?: number | null
  ): Promise<void> {
    const isReview = channel === 'review';
    await this.app
      .service('sessions')
      .recordClaudeUsage(session, result, {
        model: isReview ? (agent.model ?? undefined) : undefined,
        totalsKey: isReview ? reviewTurnKey(agent.id) : undefined,
        patchSessionCost: true,
        agentConfigId: turnAgentConfigId,
        agentId: agent.id,
      })
      .catch((err) =>
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
    const { turnComplete, streamFailed, outcome, lastResult } = await this._consumeQuery(
      sessionState,
      {
        streamWriter: sessionState.streamWriter ?? null,
        persistMessage: (message) => this.persistMessage(sessionState, message),
        persistStatus: isReview
          ? async (text) => {
              const session = await db('sessions').where({ id: sessionId }).first();
              if (session) {
                await getReviewAgentTurn(this.app)._persistStatus(session, text);
              }
            }
          : (text) => this._persistSessionStatusMessage(sessionId, userId, text),
        onInitSessionId: async (id) => {
          await patchAgentInternal(
            this.app,
            sessionState.agentId,
            { claude_session_id: id },
            userId
          );
          sessionState.claudeSessionId = id;
        },
        onStreamError: async () => {
          if (!isReview) return; // Chat status is patched once after the stream ends below.
          const session = (await db('sessions').where({ id: sessionId }).first()) as
            AgentSessionRow | undefined;
          if (!session) return;
          await getReviewAgentTurn(this.app).onAgentTurnComplete(session, 'failed', {
            sdk: 'claude',
          });
        },
        trackBackgroundTasks: true,
        activeKey,
      }
    );

    const awaitingUser = Boolean(sessionState.endTurnAwaitingUser);

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
          sessionState.turnAgentConfigId
        );
      }
    }

    if (isReview && turnComplete && !awaitingUser) {
      const session = (await db('sessions').where({ id: sessionId }).first()) as
        AgentSessionRow | undefined;
      if (session) {
        await getReviewAgentTurn(this.app).onAgentTurnComplete(
          session,
          outcome === 'completed' ? 'completed' : 'failed',
          { sdk: 'claude' }
        );
      }
    }

    // One terminal status for the whole turn (including background-task auto-resume).
    // Usage is recorded from the last SDK result; queued follow-ups start after this.
    if (!isReview && (turnComplete || streamFailed) && !awaitingUser) {
      const terminalStatus = outcome === 'completed' ? 'completed' : 'failed';
      await setAgentTurnTerminal(this.app, { id: sessionState.agentId }, userId, terminalStatus);
    }

    if (!isReview) {
      const shouldCompleteTurn = awaitingUser || (turnComplete && outcome === 'completed');
      if (shouldCompleteTurn) {
        try {
          await this.app.service('sessions').onTurnComplete(sessionId);
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
      persistStatus,
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
  }> {
    const { queryInstance, sessionId, userId } = sessionState;
    const key = activeKey ?? sessionId;

    let streamFailed = false;
    const result = await processClaudeQueryStream(queryInstance, {
      writer: streamWriter,
      persistMessage,
      persistStatus,
      onInitSessionId,
      onResult,
      trackBackgroundTasks,
      connectionClosedHint,
      onStreamError: async (err) => {
        // Service-level error wiring: log, emit app:error, route through
        // onStreamError. The stream mapper has already persisted the status row.
        if (err.name !== 'AbortError') {
          handleAppError(this.app, err, { userId, sessionId });
          logger.error({ sessionId }, 'Session stream error');
          logger.error(err, 'Session stream error');
          const userFacing =
            err.message === SDK_QUERY_CLOSED_MESSAGE ? connectionClosedHint : err.message;
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

    return {
      turnComplete: result.turnComplete,
      streamFailed: result.streamFailed || streamFailed,
      outcome: result.outcome,
      lastResult: result.lastResult,
    };
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
        ...sessionMessageIdentity(builder, 'builder'),
      },
      { user: { id: sessionRow.user_id } }
    );

    session?.channel.push(toSdkUserMessage(content));
  }

  syncSessionSettingsFromPatch(sessionId: number, _sessionRow: AgentSessionRow): void {
    const session = this.getActiveSession(sessionId);
    if (!session?.queryInstance) return;
    void (async () => {
      const builder = await getPrimaryBuilderAgent(this.app.get('db'), sessionId);
      if (!builder) return;
      const sessionRow = (await (this.app.get('db') as DbLike)('sessions')
        .where({ id: sessionId })
        .first()) as AgentSessionRow | undefined;
      if (!sessionRow) return;
      const effectiveMode = claudeSdkPermissionMode(sessionRow);
      if (session.sessionSettings) {
        session.sessionSettings.permissionMode = effectiveMode;
      }
      session.queryInstance.setPermissionMode(effectiveMode);
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

  async generateSessionMetadata(
    initialPrompt: string,
    shortId = '',
    user: { id: number } | null,
    repo: { full_name?: string | null } | null = null,
    session: Pick<AgentSessionRow, 'model'> | null = null
  ): Promise<{ label: string; branchName: string }> {
    const fallbackBranch = `task-${shortId}`;
    const prompt = `Generate metadata for a coding task. Output ONLY a JSON object with no markdown or explanation:
- "label": very short label (max 50 chars) summarizing the task
- "branch": short kebab-case git branch name suffixed with "-${shortId}" (e.g. "fix-auth-token-${shortId}"), max 60 chars

Task: ${initialPrompt}`;

    let label = '';
    let branchName = fallbackBranch;

    const metadataModel = session?.model || 'haiku';
    const env = applyClaudeAgentModelEnv(
      await getClaudeEnv(this.app, user?.id ?? 0, repo?.full_name ?? null),
      session?.model ?? null
    );
    const q = query({
      prompt,
      // Generate the label/branch with the session's selected model so the metadata
      // matches the agent that will actually run the task. Sessions created without an
      // explicit model fall back to the cheap alias so provisioning stays fast.
      options: { model: metadataModel, env },
    });
    const consume = (async () => {
      for await (const message of q) {
        const msg = message as SDKMessage & {
          subtype?: string;
          is_error?: boolean;
          result?: string;
        };
        if (msg.type === 'result' && msg.subtype === 'success' && !msg.is_error) {
          const text = (msg.result || '').trim();
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
      }
    })();

    // The CLI retries failed API calls up to 10 times with exponential backoff; a bad
    // credential or model can stall metadata for minutes. Provisioning must not wait on
    // that — fail fast and let the caller fall back to the default label/branch.
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
    } finally {
      clearTimeout(timer);
      try {
        q.close(); // end the CLI subprocess after timeout or completion
      } catch {
        /* already closed */
      }
      consume.catch(() => {}); // late failures after timeout/close are non-fatal
    }

    return { label, branchName };
  }

  async isInterruptedSessionResumable(
    session: AgentSessionRow,
    { channel = 'chat', agent: agentRow }: { channel?: MessageChannel; agent?: AgentRow } = {}
  ): Promise<boolean> {
    const db = this.app.get('db');
    let agent = agentRow;
    if (!agent) {
      agent =
        channel === 'review'
          ? ((await getReviewerAgent(db, session.id)) as AgentRow | undefined)
          : ((await getPrimaryBuilderAgent(db, session.id)) as AgentRow | undefined);
    }
    return Boolean(agent?.claude_session_id);
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

    const channel = sessionState.turnChannel ?? 'chat';
    const agentRow = (await getAgentById(this.app.get('db'), sessionState.agentId)) as
      AgentRow | undefined;
    if (!agentRow) return;

    const identity = sessionMessageIdentity(
      agentRow,
      channel === 'review' ? 'reviewer' : 'builder',
      { agent_sdk: 'claude' }
    );

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
  const service = new ClaudeAgentService();
  service.setup(app);
  app.use(path, service, {
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
      'generateSessionMetadata',
      'isInterruptedSessionResumable',
    ],
  });
  registerAgentSdk(app, {
    key: CLAUDE_AGENT_SDK_KEY,
    label: CLAUDE_AGENT_SDK_LABEL,
    servicePath: path,
  });
}
