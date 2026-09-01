import { query } from '@anthropic-ai/claude-agent-sdk';
import crypto from 'crypto';
import logger from '../../logger.js';
import { remoteHasNewCommits } from '../github.js';
import {
  getEffectiveGithubToken,
  getAllowedCommandsFromUser,
} from '../agent-settings.js';
import { getClaudeEnv } from '../session-env.js';
import { buildBaguetteMcpServer } from '../baguette-mcp-server.js';
import { createMessageChannel } from '../message-channel.js';
import { buildSystemPromptAppend } from '../session-prompt.js';
import { resolveDataDirRelativePath } from '../../config.js';
import { SDK_QUERY_CLOSED_MESSAGE } from '../../claude-agent-sdk-constants.js';

function isHumanUserMessage(message) {
  if (message.type !== 'user') return false;
  const content = message.message?.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) return !content.some((b) => b.type === 'tool_result');
  return false;
}

function commandsToAllowedTools(commands) {
  return commands.map((cmd) => `Bash(${cmd}*)`);
}

async function baseBuildQueryOptions(app, sessionRow, systemPrompt) {
  const claudeEnv = await app.service('sessions').getClaudeEnv(sessionRow.id);
  const mcpServer = buildBaguetteMcpServer(sessionRow, app);

  const cwd =
    resolveDataDirRelativePath(sessionRow.worktree_path) ||
    sessionRow.absolute_worktree_path ||
    '';

  return {
    cwd,
    env: claudeEnv,
    resume: sessionRow.claude_session_id,
    model: sessionRow.model,
    tools: { type: 'preset', preset: 'claude_code' },
    settingSources: ['project'],
    mcpServers: { baguette: mcpServer },
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: systemPrompt
    },
  };
}

async function buildBuilderQueryOptions(
  app,
  sessionRow,
  { canUseTool, abortController, allowedTools }
) {
  // Resolve installed plugins selected for this session
  let pluginRows = [];
  if (sessionRow.plugins) {
    try {
      const pluginIds = JSON.parse(sessionRow.plugins);
      if (Array.isArray(pluginIds) && pluginIds.length > 0) {
        pluginRows = await app.get('db')('plugins').whereIn('id', pluginIds);
      }
    } catch {
      // malformed plugins JSON — ignore
    }
  }

  const pluginConfigs = (pluginRows || []).map((p) => ({
    type: 'local',
    path: resolveDataDirRelativePath(p.local_path),
  }));
  const systemPrompt = await buildSystemPromptAppend(sessionRow);
  const baseOptions = await baseBuildQueryOptions(app, sessionRow, systemPrompt);
  return {
    ...baseOptions,
    // For bypassPermissions, use acceptEdits as the SDK-level mode — full bypass is handled
    // in canUseTool which auto-approves all tool calls when permissionMode is bypassPermissions.
    permissionMode: sessionRow.plan_mode
      ? 'plan'
      : sessionRow.permission_mode === 'bypassPermissions'
        ? 'acceptEdits'
        : sessionRow.permission_mode,
    canUseTool,
    abortController,
    ...(allowedTools?.length ? { allowedTools } : {}),
    ...(pluginConfigs.length ? { plugins: pluginConfigs } : {}),
  };
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

  async onMessageCreated(message) {
    if (message.type !== 'user') return;

    const sessionId = message.session_id;

    // Check in-memory first — handles active sessions before claude_session_id is persisted
    const active = this.getActiveSession(sessionId);
    if (active) {
      const parsed =
        typeof message.message_json === 'string'
          ? JSON.parse(message.message_json)
          : message.message_json;
      active.channel.push(parsed);
      return;
    }

    const session = await this.app.service('sessions').get(sessionId);
    if (!session || session.archived_at) return;

    let agentSession;
    if (session.claude_session_id) {
      agentSession = await this.ensureActiveSession(session);
    } else {
      agentSession = await this.createAgentSession(session);
    }

    const parsed =
      typeof message.message_json === 'string'
        ? JSON.parse(message.message_json)
        : message.message_json;
    agentSession.channel.push(parsed);
  }

  async createAgentSession(session) {
    const sessionState = await this._startAgentLoop(session)

    await this.app
      .service('sessions')
      .patch(session.id, { status: 'running' });
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

  async _disposeActiveSession(sessionId) {
    const session = this._activeSessions.get(sessionId);
    if (!session) return;
    try {
      // No further user turns on this query; abort signals the SDK side to stop.
      session.channel.end();
      session.abortController.abort();
    } catch (err) {
      logger.warn({ sessionId, err: err.message }, 'claude-agent session dispose cleanup');
    }
    session.permissionRequests.clear();
    this._activeSessions.delete(sessionId);
    await this._closeQueryInstanceSafe(sessionId, session.queryInstance);
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

  createCanUseTool(sessionId, userId, permissionRequests, sessionSettings) {
    const app = this.app;
    return async (toolName, input, { signal }) => {
      // Auto-allow all baguette MCP tools without showing approval UI
      if (toolName.startsWith('mcp__baguette__')) {
        return { behavior: 'allow', updatedInput: input };
      }

      // Auto-approve everything in bypass mode, except ExitPlanMode and AskUserQuestion which must always be reviewed
      if (
        sessionSettings?.bypassPermissions &&
        toolName !== 'ExitPlanMode' &&
        toolName !== 'AskUserQuestion'
      ) {
        return { behavior: 'allow', updatedInput: input };
      }

      const requestId = crypto.randomUUID();

      await app
        .service('sessions')
        .patch(sessionId, { status: 'approval' }, { user: { id: userId } });
      const approvalEvent = {
        requestId,
        sessionId,
        toolName,
        input,
        user_id: userId,
      };
      app.service('sessions').emit('permission:request', approvalEvent);

      return new Promise((resolve, reject) => {
        const onAbort = () => {
          permissionRequests.delete(requestId);
          reject(new Error('Aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });

        const resolver = async (decision) => {
          signal.removeEventListener('abort', onAbort);
          permissionRequests.delete(requestId);

          await app
            .service('sessions')
            .patch(sessionId, { status: 'running' }, { user: { id: userId } });

          if (decision.approved) {
            const updatedInput =
              toolName === 'AskUserQuestion' && decision.answers
                ? { ...input, answers: decision.answers }
                : input;
            resolve({ behavior: 'allow', updatedInput });
          } else {
            resolve({
              behavior: 'deny',
              message: decision.reason || 'Denied by user',
            });
          }
        };
        permissionRequests.set(requestId, { resolve: resolver, toolName, input, approvalEvent });
      });
    };
  }

  async injectBaguetteMessage(sessionState, { title, content }) {
    const { sessionId, channel } = sessionState;
    const app = this.app;
    const msg = {
      type: 'user',
      message: { role: 'user', content },
      title,
    };

    await app.service('messages').create({
      session_id: sessionId,
      type: 'user',
      subtype: 'baguette',
      message_json: JSON.stringify(msg),
    });

    channel.push(msg);
  }

  /**
   * Shared setup for both createSession and resumeSession: builds the
   * channel, query instance, session state, and kicks off the
   * message-processing loop.
   */
  async _startAgentLoop(sessionRow) {
    const user = await this.app.service('users').get(sessionRow.user_id, {});
    const sessionId = sessionRow.id;
    
    const channel = createMessageChannel();
    const permissionRequests = new Map();
    const abortController = new AbortController();

    const sessionSettings = {
      permissionMode: sessionRow.plan_mode ? 'plan' : sessionRow.permission_mode,
      bypassPermissions: sessionRow.permission_mode === 'bypassPermissions',
    };
    const canUseTool = this.createCanUseTool(
      sessionId,
      sessionRow.user_id,
      permissionRequests,
      sessionSettings
    );
    const allowedTools = commandsToAllowedTools(getAllowedCommandsFromUser(user));

    const queryOptions = await buildBuilderQueryOptions(this.app, sessionRow, {
      canUseTool,
      abortController,
      allowedTools,
    });

    const queryInstance = query({ prompt: channel, options: queryOptions });

    const absoluteWorktreePath = resolveDataDirRelativePath(sessionRow.worktree_path) || '';
    const sessionState = {
      sessionId,
      userId: sessionRow.user_id,
      repoFullName: sessionRow.repo_full_name,
      branch: sessionRow.base_branch,
      absoluteWorktreePath,
      repoId: sessionRow.repo_id,
      token: getEffectiveGithubToken(user),
      channel,
      queryInstance,
      permissionRequests,
      abortController,
      sessionSettings,
    };

    if (sessionRow.claude_session_id) {
      sessionState.claudeSessionId = sessionRow.claude_session_id;
    }
    
    this._activeSessions.set(sessionRow.id, sessionState);

    this.processMessages(sessionState).catch((err) => {
      logger.error({ sessionId }, err.message);
    });

    return sessionState;
  }

  async resumeSession(session) {
    if (!session.claude_session_id) throw new Error('No Claude session to resume');

    const sessionState = await this._startAgentLoop(session)

    logger.info({ sessionId: session.id, claudeSessionId: session.claude_session_id }, 'Resumed session');

    return sessionState;
  }

  async ensureActiveSession(sessionOrId) {
    const sessionRow =
      typeof sessionOrId === 'object' && sessionOrId !== null
        ? sessionOrId
        : await this.app.get('db')('sessions').where({ id: sessionOrId }).first();
    if (!sessionRow) return null;

    const sessionId = sessionRow.id;
    const existing = this._activeSessions.get(sessionId);
    if (existing) return existing;

    if (!this._resumePromises.has(sessionId)) {
      const promise = this.resumeSession(sessionRow).finally(() => {
        this._resumePromises.delete(sessionId);
      });
      this._resumePromises.set(sessionId, promise);
    }

    return this._resumePromises.get(sessionId);
  }

  async processMessages(sessionState) {
    const { queryInstance, sessionId, userId } = sessionState;
    const db = this.app.get('db');

    // Track live background tasks (replace semantics: each background_tasks_changed carries the full set).
    // We must not close the query while non-ambient background tasks are still running, because closing
    // the query terminates the CLI subprocess and kills those tasks before they can emit task_notification.
    let pendingBackgroundTaskIds = new Set();
    let turnComplete = false;

    try {
      for await (const message of queryInstance) {
        if (message.type === 'system' && message.subtype === 'init') {
          await db('sessions')
            .where({ id: sessionId })
            .update({ claude_session_id: message.session_id });
          sessionState.claudeSessionId = message.session_id;
        }

        if (message.isReplay) continue;
        if (isHumanUserMessage(message)) continue;

        // Replace background task set on every membership change.
        if (message.type === 'system' && message.subtype === 'background_tasks_changed') {
          pendingBackgroundTaskIds = new Set(
            message.tasks.filter((t) => !t.ambient).map((t) => t.task_id)
          );
        }

        await this.persistMessage(sessionState, message);

        // The result message ends the current agent turn. Informational messages (task_notification,
        // background_tasks_changed, etc.) may still follow it — do not close until background tasks settle.
        if (message.type === 'result') {
          turnComplete = true;
          if (message.subtype === 'success' && !message.is_error) {
            await this.app
              .service('sessions')
              .patch(sessionId, { status: 'completed' }, { user: { id: userId } });
          } else {
            await this.app
              .service('sessions')
              .patch(sessionId, { status: 'failed' }, { user: { id: userId } });
          }
        }

        // Exit the stream once the turn is done and no background tasks remain.
        if (turnComplete && pendingBackgroundTaskIds.size === 0) {
          break;
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        logger.error({ sessionId }, 'Session stream error');
        logger.error(err, 'Session stream error');
        await this.app
          .service('sessions')
          .patch(sessionId, { status: 'failed' }, { user: { id: userId } });
        const userFacing =
          err.message === SDK_QUERY_CLOSED_MESSAGE
            ? 'Agent connection closed before the response finished. Try sending your message again.'
            : err.message;
        try {
          await this._persistSessionStatusMessage(sessionId, userId, userFacing);
        } catch (persistErr) {
          logger.warn(
            { sessionId, err: persistErr.message },
            'Failed to persist session error status'
          );
        }
        this.app
          .service('sessions')
          .emit('app:error', { sessionId, message: userFacing, user_id: userId });
      }
    } finally {
      // Single dispose path: success (`break` after `result`), stream error, or abort — avoids double-close
      // and keeps deferred `queryInstance.close()` logic in one place.
      try {
        await this._disposeActiveSession(sessionId);
      } catch (disposeErr) {
        logger.warn({ sessionId, err: disposeErr?.message }, 'claude-agent dispose failed');
      }
    }

    // Agent is fully disposed — safe to start the next queued message as a fresh turn.
    if (turnComplete) {
      try {
        await this.app.service('sessions').onTurnComplete(sessionId);
      } catch (err) {
        logger.warn({ sessionId, err: err.message }, 'Failed to send queued message');
      }
    }
  }

  async sendMessage(sessionId, content) {
    const session = await this.ensureActiveSession(sessionId);
    const db = this.app.get('db');

    await this.app
      .service('sessions')
      .patch(sessionId, { status: 'running' }, { user: { id: session.userId } });

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
    await db('session_messages').insert({
      session_id: sessionId,
      type: 'user',
      message_json: JSON.stringify(sdkMessage),
    });

    session.channel.push({
      type: 'user',
      message: { role: 'user', content },
    });
  }

  async resolvePermission(sessionId, requestId, decision) {
    const session = await this.ensureActiveSession(sessionId);
    if (!session) return false;

    const entry = session.permissionRequests.get(requestId);
    if (!entry) return false;

    entry.resolve(decision);
    return true;
  }

  syncSessionSettingsFromPatch(sessionId, sessionRow) {
    const session = this.getActiveSession(sessionId);
    if (!session?.queryInstance) return;
    const effectiveMode = sessionRow.plan_mode ? 'plan' : sessionRow.permission_mode;
    if (session.sessionSettings) {
      session.sessionSettings.permissionMode = effectiveMode;
      session.sessionSettings.bypassPermissions = sessionRow.permission_mode === 'bypassPermissions';
    }
    // For bypassPermissions, use acceptEdits as the SDK-level mode — full bypass is handled
    // in canUseTool which auto-approves all tool calls when permissionMode is bypassPermissions.
    session.queryInstance.setPermissionMode(
      effectiveMode === 'bypassPermissions' ? 'acceptEdits' : effectiveMode
    );
    session.queryInstance.setModel(sessionRow.model);

    // When switching to bypass mode, auto-approve any pending approvals (except ExitPlanMode and AskUserQuestion)
    if (sessionRow.permission_mode === 'bypassPermissions' && session.permissionRequests?.size > 0) {
      for (const [requestId, entry] of session.permissionRequests) {
        if (entry.toolName === 'ExitPlanMode') continue;
        if (entry.toolName === 'AskUserQuestion') continue;
        entry.resolve({ approved: true });
        this.app.service('sessions').emit('permission:handled', { requestId, sessionId });
      }
    }
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
    for await (const message of query({
      prompt,
      options: { model: 'haiku', env },
    })) {
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

    return { label, branchName };
  }

  async persistMessage(sessionState, message) {
    const { sessionId, userId } = sessionState;
    const app = this.app;

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
  app.use(path, new ClaudeAgentService(), {
    methods: [
      'createAgentSession',
      'resumeSession',
      'ensureActiveSession',
      'sendMessage',
      'resolvePermission',
      'stopSession',
      'syncSessionSettingsFromPatch',
      'onMessageCreated',
    ],
  });
}
