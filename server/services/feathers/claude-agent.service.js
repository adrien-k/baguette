import { query } from '@anthropic-ai/claude-agent-sdk';
import logger from '../../logger.js';
import { remoteHasNewCommits } from '../github.js';
import { getGithubToken, getAllowedCommandsFromUser } from '../agent-settings.js';
import { attachAppErrorHandler, handleAppError } from '../../lib/app-error-handler.js';
import { getClaudeEnv } from '../session-env.js';
import { buildBaguetteMcpServer } from '../baguette-mcp-server.js';
import { createMessageChannel } from '../message-channel.js';
import { buildSystemPromptAppend } from '../session-prompt.js';
import { getEffectiveAgentPrompt } from '../effective-user-prompts.js';
import { resolveDataDirRelativePath } from '../../config.js';
import { SDK_QUERY_CLOSED_MESSAGE } from '../../claude-agent-sdk-constants.js';
import { normalizeUserMessageForAgentSdk } from '../../../shared/user-message-content.js';
import {
  attachSessionTurnModelFields,
  isBaguetteUserMessage,
  resolveTurnModel,
} from '../../../shared/turn-model.js';
import { reviewTurnKey } from './session-review.service.js';
import {
  isDispatchableUserMessage,
  parseUserRow,
  rejectTurnMismatch,
} from '../agent-message-dispatch.js';
import { createMessageStreamWriter } from '../message-writer-factory.js';

function isHumanUserMessage(message) {
  if (message.type !== 'user') return false;
  if (typeof message.content === 'string') return true;
  const content = message.message?.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) return !content.some((b) => b.type === 'tool_result');
  return false;
}

function commandsToAllowedTools(commands) {
  return commands.map((cmd) => `Bash(${cmd}*)`);
}

/** Hard cap on session metadata (label/branch) generation — provisioning must not stall on CLI API retries. */
const METADATA_TIMEOUT_MS = 30_000;

function claudeSdkPermissionMode(sessionRow) {
  return sessionRow.plan_mode ? 'plan' : 'acceptEdits';
}

function toSdkUserMessage(prompt) {
  if (prompt && typeof prompt === 'object') return prompt;
  return { type: 'user', message: { role: 'user', content: prompt ?? '' } };
}

// ─── ClaudeAgentService class ─────────────────────────────────────────────────

export class ClaudeAgentService {
  constructor() {
    this._activeSessions = new Map();
    this._resumePromises = new Map();
  }

  setup(app, _path) {
    this.app = app;
  }

  /**
   * SDK query options for a Claude turn. Callers override MCP, prompt, tools, resume, etc.
   */
  async buildQueryOptions(
    sessionRow,
    {
      systemPrompt,
      mcpServer,
      allowedTools,
      permissionMode = 'acceptEdits',
      settingSources = ['project'],
      resume,
      model,
      canUseTool,
      plugins,
    } = {}
  ) {
    const claudeEnv = await this.app.service('sessions').getClaudeEnv(sessionRow.id);
    const cwd =
      resolveDataDirRelativePath(sessionRow.worktree_path) ||
      sessionRow.absolute_worktree_path ||
      '';
    const resolvedMcp = mcpServer ?? (await buildBaguetteMcpServer(sessionRow, this.app));
    return {
      cwd,
      env: claudeEnv,
      resume: resume !== undefined ? resume || undefined : sessionRow.claude_session_id,
      model: model !== undefined ? model : sessionRow.model,
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
    };
  }

  async _buildSessionQueryOptions(sessionRow, { canUseTool, allowedTools, model } = {}) {
    let pluginRows = [];
    if (sessionRow.plugins) {
      try {
        const pluginIds = JSON.parse(sessionRow.plugins);
        if (Array.isArray(pluginIds) && pluginIds.length > 0) {
          pluginRows = await this.app.get('db')('plugins').whereIn('id', pluginIds);
        }
      } catch {
        // malformed plugins JSON — ignore
      }
    }
    const plugins = (pluginRows || []).map((p) => ({
      type: 'local',
      path: resolveDataDirRelativePath(p.local_path),
    }));
    const agentPrompt = await getEffectiveAgentPrompt(
      this.app,
      sessionRow.user_id,
      sessionRow.repo_id
    );
    const systemPrompt = await buildSystemPromptAppend(sessionRow, { agentPrompt });
    return this.buildQueryOptions(sessionRow, {
      systemPrompt,
      canUseTool,
      allowedTools,
      permissionMode: claudeSdkPermissionMode(sessionRow),
      plugins,
      ...(model !== undefined ? { model } : {}),
    });
  }

  _openQuery({ sessionId, userId, queryOptions, extraState = {}, activeKey }) {
    const channel = createMessageChannel();
    const abortController = new AbortController();
    const queryInstance = query({
      prompt: channel,
      options: { ...queryOptions, abortController },
    });
    const state = {
      sessionId,
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
  async runTurn({
    sessionId,
    userId,
    prompt,
    queryOptions,
    persistMessage,
    persistStatus,
    onInitSessionId,
    onResult,
    onStreamError,
    trackBackgroundTasks = false,
    activeKey,
    extraState,
    connectionClosedHint = 'Agent connection closed before the response finished. Try sending your message again.',
  }) {
    const key = activeKey ?? sessionId;
    const state = this._openQuery({
      sessionId,
      userId,
      queryOptions,
      extraState,
      activeKey: key,
    });
    if (prompt != null) {
      state.channel.push(toSdkUserMessage(prompt));
    }
    return await this._consumeQuery(state, {
      persistMessage,
      persistStatus,
      onInitSessionId,
      onResult,
      onStreamError,
      trackBackgroundTasks,
      activeKey: key,
      connectionClosedHint,
    });
  }

  async stopTurn(activeKey) {
    await this._disposeActiveSession(activeKey);
  }

  async handleTableMessageCreated(row, table) {
    if (row.type !== 'user') return;

    const parsedStorage = parseUserRow(row);
    if (!parsedStorage || !isDispatchableUserMessage(parsedStorage)) return;

    const sessionId = row.session_id;
    const session = await this.app.service('sessions').get(sessionId);
    if (!session || session.archived_at) return;

    const channel = table === 'session-review-messages' ? 'review' : 'chat';
    const sdk = channel === 'review' ? session.review_agent_sdk : session.agent_sdk;
    if (sdk !== 'claude') return;

    if (channel === 'chat') {
      if (session.status === 'archiving' || session.status === 'archived') return;
      if (session.repo_full_name && !session.worktree_path) return;
    }

    const activeKey = channel === 'review' ? reviewTurnKey(sessionId) : sessionId;
    const active = this.getActiveSession(activeKey);
    const activeTurnId =
      channel === 'review' ? session.active_review_turn_id : session.active_chat_turn_id;

    let forSdk = parsedStorage;
    if (isBaguetteUserMessage(parsedStorage) && typeof parsedStorage.content === 'string') {
      forSdk = {
        type: 'user',
        source: 'baguette',
        title: parsedStorage.title,
        message: { role: 'user', content: parsedStorage.content },
      };
    } else if (typeof parsedStorage.content === 'string') {
      forSdk = { type: 'user', message: { role: 'user', content: parsedStorage.content } };
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

    const db = this.app.get('db');
    if (row.turn_id != null) {
      const activeField =
        channel === 'review'
          ? { active_review_turn_id: row.turn_id }
          : { active_chat_turn_id: row.turn_id };
      await db('sessions').where({ id: sessionId }).update(activeField);
    }

    const { model } = resolveTurnModel(row, session);
    const writer =
      row.turn_id != null
        ? createMessageStreamWriter(this.app, {
            sessionId,
            userId: session.user_id,
            turnId: row.turn_id,
            channel,
            worktreePath: session.worktree_path,
          })
        : null;

    let agentSession;
    const resumeId =
      channel === 'review' ? session.review_claude_session_id : session.claude_session_id;
    if (resumeId) {
      agentSession = await this.ensureActiveSession(session, { model, channel, activeKey, writer });
    } else {
      agentSession = await this.createAgentSession(session, {
        model,
        channel,
        activeKey,
        writer,
      });
    }

    agentSession.channel.push(parsed);
  }

  /** @deprecated use handleTableMessageCreated */
  async onMessageCreated(message) {
    return this.handleTableMessageCreated(message, 'messages');
  }

  async createAgentSession(session, { model, channel, activeKey, writer } = {}) {
    const sessionState = await this._startAgentLoop(session, {
      model,
      channel,
      activeKey,
      writer,
    });

    if (channel !== 'review') {
      await this.app.service('sessions').patch(session.id, { status: 'running' });
      await this.app.service('sessions').onTurnStart(session.id);
    }
    return sessionState;
  }

  /** @param {number | { id: number }} sessionOrId */
  getActiveSession(sessionOrId) {
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
  async _closeQueryInstanceSafe(sessionId, queryInstance) {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      queryInstance.close();
    } catch (err) {
      logger.warn({ sessionId, err: err.message }, 'claude-agent session dispose cleanup');
    }
  }

  async _disposeActiveSession(activeKey) {
    const session = this._activeSessions.get(activeKey);
    if (!session) return;
    try {
      // No further user turns on this query; abort signals the SDK side to stop.
      session.channel.end();
      session.abortController.abort();
    } catch (err) {
      logger.warn(
        { sessionId: session.sessionId, err: err.message },
        'claude-agent session dispose cleanup'
      );
    }
    this._activeSessions.delete(activeKey);
    await this._closeQueryInstanceSafe(session.sessionId, session.queryInstance);
  }

  async _persistSessionStatusMessage(sessionId, userId, statusText) {
    const payload = {
      type: 'system',
      subtype: 'status',
      status: statusText,
    };
    await this.app.service('messages').create(
      {
        session_id: sessionId,
        type: 'system',
        subtype: 'status',
        message_json: JSON.stringify(payload),
      },
      { provider: undefined, user: { id: userId } }
    );
  }

  createCanUseTool() {
    return async (toolName, input) => {
      if (toolName === 'ExitPlanMode') {
        return {
          behavior: 'allow',
          updatedInput: input,
          message:
            'Plan saved for user review in chat. The turn can complete; the user will message when ready to execute or refine.',
        };
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

  async injectBaguetteMessage(sessionState, { title, content }) {
    const { sessionId } = sessionState;
    const app = this.app;
    const payload = {
      type: 'user',
      source: 'baguette',
      title,
      content,
      subtype: 'baguette',
    };

    await app.service('messages').create({
      session_id: sessionId,
      type: 'user',
      subtype: 'baguette',
      message_json: JSON.stringify(payload),
    });
  }

  /**
   * Shared setup for both createSession and resumeSession: builds the
   * channel, query instance, session state, and kicks off the
   * message-processing loop.
   */
  async _startAgentLoop(sessionRow, { model, channel = 'chat', activeKey, writer } = {}) {
    const user = await this.app.service('users').get(sessionRow.user_id, {});
    const sessionId = sessionRow.id;
    const sessionSettings = {
      permissionMode: claudeSdkPermissionMode(sessionRow),
    };
    const canUseTool = this.createCanUseTool();
    const allowedTools = commandsToAllowedTools(getAllowedCommandsFromUser(user));
    const resolvedActiveKey = activeKey ?? sessionId;
    let queryOptions;
    if (channel === 'review') {
      const extras = this.app.service('session-review').peekTurnExtras(sessionId) ?? {};
      const resumeId = sessionRow.review_claude_session_id;
      queryOptions = await this.app.service('session-review').buildClaudeQueryOptions(sessionRow, {
        model,
        continuation: !!resumeId || Boolean(extras.continuation),
        extraPrompt: extras.extraPrompt,
      });
    } else {
      queryOptions = await this._buildSessionQueryOptions(sessionRow, {
        canUseTool,
        allowedTools,
        ...(model !== undefined ? { model } : {}),
      });
    }

    const absoluteWorktreePath = resolveDataDirRelativePath(sessionRow.worktree_path) || '';
    const sessionState = this._openQuery({
      sessionId,
      userId: sessionRow.user_id,
      queryOptions,
      extraState: {
        repoFullName: sessionRow.repo_full_name,
        branch: sessionRow.base_branch,
        absoluteWorktreePath,
        repoId: sessionRow.repo_id,
        token: getGithubToken(user),
        sessionSettings,
        ...(sessionRow.claude_session_id ? { claudeSessionId: sessionRow.claude_session_id } : {}),
        streamWriter: writer ?? null,
        turnChannel: channel,
        activeKey: resolvedActiveKey,
      },
      activeKey: resolvedActiveKey,
    });

    attachAppErrorHandler(this.app, this.processMessages(sessionState), {
      userId: sessionRow.user_id,
      sessionId,
    }).catch((err) => {
      logger.error({ sessionId }, err.message);
    });

    return sessionState;
  }

  async resumeSession(session, { model, channel, activeKey, writer } = {}) {
    const resumeId =
      channel === 'review' ? session.review_claude_session_id : session.claude_session_id;
    if (!resumeId) throw new Error('No Claude session to resume');

    const sessionState = await this._startAgentLoop(session, {
      model,
      channel,
      activeKey,
      writer,
    });

    logger.info(
      { sessionId: session.id, claudeSessionId: session.claude_session_id },
      'Resumed session'
    );

    return sessionState;
  }

  async ensureActiveSession(sessionOrId, { model, channel, activeKey, writer } = {}) {
    const sessionRow =
      typeof sessionOrId === 'object' && sessionOrId !== null
        ? sessionOrId
        : await this.app.get('db')('sessions').where({ id: sessionOrId }).first();
    if (!sessionRow) return null;

    const sessionId = sessionRow.id;
    const key = activeKey ?? sessionId;
    const existing = this._activeSessions.get(key);
    if (existing) return existing;

    if (!this._resumePromises.has(key)) {
      const promise = this.resumeSession(sessionRow, {
        model,
        channel,
        activeKey: key,
        writer,
      }).finally(() => {
        this._resumePromises.delete(key);
      });
      this._resumePromises.set(key, promise);
    }

    return this._resumePromises.get(key);
  }

  async processMessages(sessionState) {
    const { sessionId, userId } = sessionState;
    const db = this.app.get('db');
    const activeKey = sessionState.activeKey ?? sessionId;
    const isReview = sessionState.turnChannel === 'review';
    const { turnComplete, streamFailed, outcome } = await this._consumeQuery(sessionState, {
      streamWriter: sessionState.streamWriter ?? null,
      persistMessage: (message) => this.persistMessage(sessionState, message),
      persistStatus: isReview
        ? async (text) => {
            const session = await db('sessions').where({ id: sessionId }).first();
            if (session) {
              await this.app.service('session-review')._persistStatus(session, text);
            }
          }
        : (text) => this._persistSessionStatusMessage(sessionId, userId, text),
      onInitSessionId: async (id) => {
        const field =
          sessionState.turnChannel === 'review'
            ? { review_claude_session_id: id }
            : { claude_session_id: id };
        await db('sessions').where({ id: sessionId }).update(field);
        sessionState.claudeSessionId = id;
      },
      onResult: async (message) => {
        if (!isReview) return; // Chat status is patched once after the stream ends below.
        const ok = message.subtype === 'success' && !message.is_error;
        const session = await db('sessions').where({ id: sessionId }).first();
        await this.app
          .service('sessions')
          .recordClaudeUsage(session, message, {
            kind: 'review',
            model: session.review_model ?? session.model,
            totalsKey: reviewTurnKey(sessionId),
            patchSessionCost: true,
          })
          .catch(() => {});
        await this.app
          .service('session-review')
          .onAgentTurnComplete(session, ok ? 'completed' : 'failed', { sdk: 'claude' });
      },
      onStreamError: async () => {
        if (!isReview) return; // Chat status is patched once after the stream ends below.
        const session = await db('sessions').where({ id: sessionId }).first();
        await this.app.service('session-review').onAgentTurnComplete(session, 'failed', {
          sdk: 'claude',
        });
      },
      onBackgroundAutoResume: async () => {
        if (isReview) return;
        await this.app.service('sessions').onTurnStart(sessionId);
      },
      trackBackgroundTasks: true,
      activeKey,
    });

    // One terminal status for the whole turn (including background-task auto-resume).
    // Usage is recorded when the result message is persisted; queued follow-ups start after this.
    if (!isReview && (turnComplete || streamFailed)) {
      const terminalStatus = outcome === 'completed' ? 'completed' : 'failed';
      await this.app
        .service('sessions')
        .patch(sessionId, { status: terminalStatus }, { user: { id: userId } });
    }

    if (turnComplete && !isReview) {
      try {
        await this.app.service('sessions').onTurnComplete(sessionId);
      } catch (err) {
        logger.warn({ sessionId, err: err.message }, 'Failed to send queued message');
      }
    }
  }

  /**
   * Consume an open Claude query until the turn ends (result, abort, or stream error).
   * @returns {Promise<{ turnComplete: boolean, streamFailed: boolean, outcome: 'completed' | 'failed' | 'stopped' }>}
   */
  async _consumeQuery(
    sessionState,
    {
      streamWriter,
      persistMessage,
      persistStatus,
      onInitSessionId,
      onResult,
      onStreamError,
      onBackgroundAutoResume,
      trackBackgroundTasks = false,
      activeKey,
      connectionClosedHint = 'Agent connection closed before the response finished. Try sending your message again.',
    }
  ) {
    const { queryInstance, sessionId, userId } = sessionState;
    const key = activeKey ?? sessionId;
    let pendingBackgroundTaskIds = new Set();
    let awaitingAutoResume = false;
    let turnComplete = false;
    let streamFailed = false;
    let outcome = 'failed';

    try {
      for await (const message of queryInstance) {
        if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
          await onInitSessionId?.(message.session_id);
        }

        if (message.isReplay) continue;
        if (isHumanUserMessage(message)) continue;

        if (trackBackgroundTasks) {
          if (message.type === 'system' && message.subtype === 'task_started' && !message.ambient) {
            pendingBackgroundTaskIds.add(message.task_id);
          }
          if (
            message.type === 'system' &&
            message.subtype === 'task_notification' &&
            !message.ambient
          ) {
            const isTerminal =
              message.status === 'completed' ||
              message.status === 'failed' ||
              message.status === 'error';
            if (isTerminal) {
              pendingBackgroundTaskIds.delete(message.task_id);
              if (turnComplete && pendingBackgroundTaskIds.size === 0) {
                awaitingAutoResume = true;
                await onBackgroundAutoResume?.();
              }
            }
          }
        }

        if (streamWriter) {
          await streamWriter.handleClaudeEvent(message);
        } else {
          await persistMessage(message);
        }

        if (message.type === 'result') {
          turnComplete = true;
          awaitingAutoResume = false;
          const ok = message.subtype === 'success' && !message.is_error;
          outcome = ok ? 'completed' : 'failed';
          await onResult?.(message);
        }

        if (turnComplete && pendingBackgroundTaskIds.size === 0 && !awaitingAutoResume) {
          break;
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        handleAppError(this.app, err, { userId, sessionId });
        logger.error({ sessionId }, 'Session stream error');
        logger.error(err, 'Session stream error');
        const userFacing =
          err.message === SDK_QUERY_CLOSED_MESSAGE ? connectionClosedHint : err.message;
        try {
          await persistStatus?.(userFacing);
        } catch (persistErr) {
          logger.warn(
            { sessionId, err: persistErr.message },
            'Failed to persist session error status'
          );
        }
        await onStreamError?.(err);
        this.app
          .service('sessions')
          .emit('app:error', { sessionId, message: userFacing, user_id: userId });
        outcome = 'failed';
        streamFailed = true;
      } else {
        outcome = 'stopped';
      }
    } finally {
      try {
        await this._disposeActiveSession(key);
      } catch (disposeErr) {
        logger.warn({ sessionId, err: disposeErr?.message }, 'claude-agent dispose failed');
      }
    }

    return { turnComplete, streamFailed, outcome };
  }

  async sendMessage(sessionId, content) {
    const session = await this.ensureActiveSession(sessionId);
    const db = this.app.get('db');

    await this.app
      .service('sessions')
      .patch(sessionId, { status: 'running' }, { user: { id: session.userId } });
    await this.app.service('sessions').onTurnStart(sessionId);

    const sessionRow = await db('sessions').where({ id: sessionId }).first();
    const absoluteWorktreePath = resolveDataDirRelativePath(sessionRow?.worktree_path);
    if (sessionRow?.remote_branch && absoluteWorktreePath && session.token) {
      try {
        const hasNew = await remoteHasNewCommits(
          absoluteWorktreePath,
          sessionRow.remote_branch,
          session.token,
          session.repoFullName
        );
        if (hasNew) {
          await this.injectBaguetteMessage(session, {
            title: 'Syncing with remote',
            content:
              'There are new commits on the remote branch. Please pull the latest changes, ' +
              'resolve any merge conflicts, and commit the merge before we proceed.',
          });
        }
      } catch (err) {
        logger.error(err, 'Remote check error (non-fatal)');
      }
    }

    const sdkMessage = { type: 'user', message: { role: 'user', content } };
    const row = {
      session_id: sessionId,
      type: 'user',
      agent_type: 'builder',
      message_json: JSON.stringify(sdkMessage),
    };
    attachSessionTurnModelFields(row, sessionRow);
    await db('session_messages').insert(row);

    session.channel.push({
      type: 'user',
      message: { role: 'user', content },
    });
  }

  syncSessionSettingsFromPatch(sessionId, sessionRow) {
    const session = this.getActiveSession(sessionId);
    if (!session?.queryInstance) return;
    const effectiveMode = claudeSdkPermissionMode(sessionRow);
    if (session.sessionSettings) {
      session.sessionSettings.permissionMode = effectiveMode;
    }
    session.queryInstance.setPermissionMode(effectiveMode);
    session.queryInstance.setModel(sessionRow.model);
  }

  async stopSession(sessionId) {
    await this._disposeActiveSession(sessionId);
  }

  async generateSessionMetadata(initialPrompt, shortId = '', user, repo = null) {
    const fallbackBranch = `task-${shortId}`;
    const prompt = `Generate metadata for a coding task. Output ONLY a JSON object with no markdown or explanation:
- "label": very short label (max 50 chars) summarizing the task
- "branch": short kebab-case git branch name suffixed with "-${shortId}" (e.g. "fix-auth-token-${shortId}"), max 60 chars

Task: ${initialPrompt}`;

    let label = '';
    let branchName = fallbackBranch;

    const env = await getClaudeEnv(this.app, user.id, repo?.full_name ?? null);
    const q = query({
      prompt,
      options: { model: 'haiku', env },
    });
    const consume = (async () => {
      for await (const message of q) {
        if (message.type === 'result' && message.subtype === 'success' && !message.is_error) {
          const text = (message.result || '').trim();
          try {
            const jsonText = text
              .replace(/^```(?:json)?\n?/, '')
              .replace(/\n?```$/, '')
              .trim();
            const parsed = JSON.parse(jsonText);
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
    let timer;
    try {
      await Promise.race([
        consume,
        new Promise((_, reject) => {
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

  async persistMessage(sessionState, message) {
    const { sessionId, userId } = sessionState;
    const app = this.app;

    if (message.type === 'system' && message.subtype === 'thinking_tokens') {
      return;
    }

    await app.service('messages').create(
      {
        session_id: sessionId,
        type: message.type,
        subtype: message.subtype ?? null,
        uuid: message.uuid ?? null,
        message_json: JSON.stringify(message),
        total_cost_usd: message.type === 'result' ? (message.total_cost_usd ?? null) : null,
      },
      { provider: undefined, user: { id: userId } }
    );
  }

  // Required by @feathersjs/express to recognise this as a Feathers service
  // rather than Express middleware.
  async get(id) {
    return this.getActiveSession(id) ?? null;
  }
}

export function registerClaudeAgentService(app, path = 'claude-agent') {
  const service = new ClaudeAgentService();
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
      'onMessageCreated',
      'handleTableMessageCreated',
    ],
  });
}
