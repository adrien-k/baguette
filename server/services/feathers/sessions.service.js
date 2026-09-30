import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { NotFound, BadRequest } from '@feathersjs/errors';
import { KnexService } from '@feathersjs/knex';
const execFileAsync = promisify(execFile);
import {
  loadBaguetteConfig,
  readBaguetteConfigRaw,
  getAvailableCommands,
  getScriptBlock,
  BaguetteConfigError,
} from '../baguette-config.js';
import {
  removeWorktree,
  gitDiff,
  gitShowCommitDiff,
  gitDiffNumstat,
  gitShowCommitNumstat,
  gitHasUncommitted,
  gitCommitsToPush,
  gitLocalAndRemoteSha,
  gitLogSinceBase,
  gitFetch,
  gitPush,
  mergePR,
  markPRReady,
  markPRDraft,
  getPRStatus,
  upsertPR,
  createWorktree,
  configureWorktreeGitIdentity,
  uniqueLocalBranch,
  trySetBranchUpstream,
  getOpenPRByNumber,
  getOpenPR,
  splitPrBody,
  buildPrBody,
  buildSessionFooter,
} from '../github.js';
import { loadSessionFooterUsageLines } from '../pr-footer-usage.js';
import logger from '../../logger.js';
import { requireUser, scopeByUser } from './hooks.js';
import { DEFAULT_PAGINATE, DATA_DIR, resolveDataDirRelativePath } from '../../config.js';
import { isGlobalSession } from '../../../shared/session-scope.js';
import { computeSessionGitStatus } from '../session-git-status.js';
import { getPreviewHost } from '../preview.js';
import {
  getPreviewServiceDefinitions,
  getSessionPreviewUrl,
  resolvePreviewServiceConfig,
  sessionHasPreviewConfig,
} from '../preview-services.js';
import { isPortListening } from '../port-utils.js';
import path from 'path';
import { buildTaskEnv, getClaudeEnvForSession, interpolateTaskCommand } from '../session-env.js';
import { getGithubToken } from '../agent-settings.js';
import { buildSystemPromptAppend } from '../session-prompt.js';
import { getEffectiveAgentPrompt } from '../effective-user-prompts.js';
import { delta, diffModelUsage } from '../turn-usage.js';
import { getCodeserverUrl } from '../codeserver-handler.js';
import { removeSessionDockerResources } from '../docker-session.js';
import { PREVIEW_WEBSERVICE_TTL_MS } from '../task.js';
import { turnModelCreateFields } from '../../../shared/turn-model.js';
import {
  queryFlagDisabled,
  queryFlagEnabled,
  SESSION_LIST_QUERY_FLAGS,
} from '../../../shared/session-list-query.js';
import { DEBOUNCE_DELAY_MS } from '../session-activity.js';
import { messageCountsAsSessionActivity } from '../../../shared/session-activity-message.js';

/**
 * Sent to an agent whose turn was cut short by a server restart. The transcript is resumed, but
 * the last turn may have stopped anywhere — mid tool call, mid edit — so the agent is asked to
 * re-check the working tree rather than trust what it remembers writing.
 */
const RESTART_PROMPT =
  'The Baguette server restarted and interrupted your previous turn before it finished. ' +
  'Check the current state of the working tree (any edit or command you had started may or may ' +
  'not have completed), then continue the task from where you left off.';

const PROVISIONING_STATUS = 'provisioning';
const ARCHIVING_STATUS = 'archiving';
const ARCHIVED_STATUS = 'archived';

/**
 * Sessions service (table: sessions). All methods restricted to params.user's sessions.
 */
export class SessionsService extends KnexService {
  constructor(options) {
    super(options);
    // Last result message's running totals per session, for differencing the next
    // one. Held in memory only: a restart also restarts the agent's own counters,
    // so an absent entry and a reset counter line up.
    this._lastResultTotals = new Map();
    /** @type {Record<number, number>} When `onActivity` last ran per session (ms since epoch). */
    this._sessionActivityLastBumpMs = Object.create(null);
  }

  setup(app) {
    this.app = app;
    /** @type {Map<number, Promise<unknown>>} */
    this._provisioningBySessionId = new Map();
    /** Session ids currently in `remove()` — a second archive is rejected. */
    this._archivePendingSessionIds = new Set();
  }

  /** Wire `messages` / `session-review-messages` create events → `last_activity_at` (call after all services register). */
  registerActivityMessageListeners(app) {
    if (this._sessionActivityListenersRegistered) return;
    this._sessionActivityListenersRegistered = true;
    this.app = app;
    const onCreated = (data) => this._bumpLastActivityOnMessageCreated(data);
    app.service('messages').on('created', onCreated);
    app.service('session-review-messages').on('created', onCreated);
  }

  _bumpLastActivityOnMessageCreated(message) {
    const sessionId = message?.session_id;
    if (!sessionId) return;
    if (!messageCountsAsSessionActivity(message)) return;
    const lastBumpMs = this._sessionActivityLastBumpMs[sessionId];
    if (lastBumpMs != null && Date.now() - lastBumpMs < DEBOUNCE_DELAY_MS) return;
    this._sessionActivityLastBumpMs[sessionId] = Date.now();
    void this.onActivity(sessionId).catch((err) => {
      logger.warn({ sessionId, err: err.message }, 'Failed to bump session last_activity_at');
    });
  }

  /** Updates `last_activity_at` for a non-archived session (throttled via message create listeners). */
  async onActivity(sessionOrId) {
    const db = this.app.get('db');
    const session =
      typeof sessionOrId === 'object' && sessionOrId !== null
        ? sessionOrId
        : await db('sessions').where({ id: sessionOrId }).first();
    if (!session?.id) return;
    if (
      session.archived_at ||
      session.status === ARCHIVING_STATUS ||
      session.status === ARCHIVED_STATUS
    )
      return;
    const last_activity_at = new Date().toISOString();
    await this.patch(
      session.id,
      { last_activity_at },
      { provider: undefined, user: { id: session.user_id } }
    );
  }

  _trackProvisioning(sessionId, promise) {
    this._provisioningBySessionId.set(sessionId, promise);
    promise.finally(() => {
      if (this._provisioningBySessionId.get(sessionId) === promise) {
        this._provisioningBySessionId.delete(sessionId);
      }
    });
  }

  async _awaitProvisioning(sessionId) {
    const pending = this._provisioningBySessionId.get(sessionId);
    if (pending) await pending.catch(() => {});
  }

  /**
   * Recover sessions that were mid-turn when the server last stopped.
   *
   * A session left in `running`/`approval` has no agent process behind it after a reboot, so it
   * would otherwise sit there forever. Sessions whose agent conversation can be resumed
   * (`claude_session_id` / `cursor_agent_id`) are restarted by injecting a follow-up user message
   * that tells the agent to pick up where it left off; the rest fall back to being marked stopped.
   * Reviews left in `review_status: 'running'` are resumed the same way when a review agent id is stored.
   *
   * Call this after `app.setup()` — restarting reaches into the agent services, which need their
   * own `setup()` to have run first.
   */
  async restartInterruptedSessions() {
    const db = this.app.get('db');
    const counts = { restarted: 0, stopped: 0, failed: 0 };
    await this._abandonUnfinishedProvisioning(counts);
    await this._completeInterruptedArchives(counts);
    await this._repairArchivedSessionStatus();
    let interrupted;
    try {
      interrupted = await db('sessions')
        .whereIn('status', ['running', 'approval'])
        .whereNull('archived_at')
        .select('id', 'user_id', 'agent_sdk', 'claude_session_id', 'cursor_agent_id');
    } catch (err) {
      logger.error(err, 'Failed to load interrupted sessions on startup');
      return counts;
    }

    // Sequential: each restart spawns an agent process, so a burst of them on boot would
    // compete for CPU and API rate limits.
    for (const session of interrupted) {
      try {
        if (await this._restartInterruptedSession(session)) counts.restarted++;
        else counts.stopped++;
      } catch (err) {
        // Recovery is best-effort per session — one bad session must not strand the others.
        counts.failed++;
        logger.error({ err, sessionId: session.id }, 'Failed to recover interrupted session');
      }
    }
    if (interrupted.length > 0) {
      logger.info(counts, 'Recovered interrupted session(s) on startup');
    }

    await this._resumeInterruptedReviews();

    return counts;
  }

  /**
   * Restart a single interrupted session. Returns true if it was resumed, false if it was
   * only marked stopped (nothing to resume from).
   */
  async _restartInterruptedSession(session) {
    const userParams = { user: { id: session.user_id } };
    const resumable =
      session.agent_sdk === 'cursor' ? !!session.cursor_agent_id : !!session.claude_session_id;

    if (!resumable) {
      // Nothing was ever persisted on the agent side, so there is no transcript to pick up —
      // the user has to re-send.
      await this._stopInterruptedSession(session.id, userParams, 'session was stopped');
      return false;
    }

    await this._postStatusMessage(session.id, userParams, 'Server restarted — resuming session');
    try {
      // An internal create (no `provider`) skips the queue-while-running hook and goes straight
      // to the agent service, which resumes the stored conversation before pushing this message.
      await this.app.service('messages').create(
        {
          session_id: session.id,
          type: 'user',
          subtype: 'baguette',
          // `source` makes the chat collapse this into a Baguette block rather than showing it
          // as something the user typed, and keeps it from counting as a user reply.
          message_json: JSON.stringify({
            type: 'user',
            source: 'baguette',
            message: { role: 'user', content: RESTART_PROMPT },
            title: 'Server restarted',
          }),
        },
        userParams
      );
    } catch (err) {
      // The dispatch above flips the session back to `running`; leaving it there would show a
      // live session with no agent behind it, so fall back to the stopped path.
      logger.error({ err, sessionId: session.id }, 'Failed to resume interrupted session');
      await this._stopInterruptedSession(
        session.id,
        userParams,
        `could not resume session (${err.message})`
      );
      return false;
    }
    return true;
  }

  /**
   * Provisioning lives in-memory. After a reboot those jobs are gone, so a `provisioning`
   * row would sit forever with a half-created worktree. Mark them failed and wipe anything
   * that did land on disk.
   */
  async _abandonUnfinishedProvisioning(counts) {
    const db = this.app.get('db');
    let stuck;
    try {
      stuck = await db('sessions')
        .where({ status: PROVISIONING_STATUS })
        .whereNull('archived_at')
        .select('id', 'user_id');
    } catch (err) {
      logger.error(err, 'Failed to load unfinished provisioning sessions on startup');
      return;
    }
    for (const session of stuck) {
      const user = { id: session.user_id };
      try {
        await failSessionProvisioning(
          this.app,
          session.id,
          user,
          new Error('server restarted before setup finished')
        );
        counts.stopped++;
      } catch (err) {
        counts.failed++;
        logger.error(
          { err, sessionId: session.id },
          'Failed to abandon unfinished provisioning session'
        );
      }
    }
  }

  /** Sessions archived before status was persisted — fix `archiving` → `archived`. */
  async _repairArchivedSessionStatus() {
    const db = this.app.get('db');
    try {
      await db('sessions')
        .whereNotNull('archived_at')
        .where({ status: ARCHIVING_STATUS })
        .update({ status: ARCHIVED_STATUS });
    } catch (err) {
      logger.error(err, 'Failed to repair archived session status on startup');
    }
  }

  /**
   * Archive was waiting on worktree cleanup when the process died. Finish wiping
   * the worktree and set `archived_at` / `archived` status.
   */
  async _completeInterruptedArchives(counts) {
    const db = this.app.get('db');
    let stuck;
    try {
      stuck = await db('sessions')
        .where({ status: ARCHIVING_STATUS })
        .whereNull('archived_at')
        .select('id');
    } catch (err) {
      logger.error(err, 'Failed to load unfinished archive sessions on startup');
      return;
    }
    for (const session of stuck) {
      try {
        await this._finalizeRemoval(session.id);
        counts.stopped++;
      } catch (err) {
        counts.failed++;
        logger.error({ err, sessionId: session.id }, 'Failed to complete interrupted archive');
      }
    }
  }

  async _stopInterruptedSession(sessionId, userParams, reason) {
    // `can_continue` drives the chat's one-click Continue button — the manual fallback for
    // everything auto-restart could not pick up itself.
    await this._postStatusMessage(sessionId, userParams, `Server restarted — ${reason}`, {
      can_continue: true,
    });
    await this.app.service('sessions').patch(sessionId, { status: 'stopped' }, userParams);
  }

  _postStatusMessage(sessionId, userParams, status, extra = {}) {
    return this.app.service('messages').create(
      {
        session_id: sessionId,
        type: 'system',
        subtype: 'status',
        message_json: JSON.stringify({ type: 'system', subtype: 'status', status, ...extra }),
      },
      userParams
    );
  }

  async getTaskEnv(sessionId, taskKey = null) {
    return buildTaskEnv(this.app.get('db'), sessionId, taskKey);
  }

  async getInterpolatedCommand(sessionId, command) {
    return interpolateTaskCommand(this.app.get('db'), sessionId, command);
  }

  async getClaudeEnv(sessionId) {
    return getClaudeEnvForSession(this.app, sessionId);
  }

  async removeByRepoId(repoId, params) {
    const db = this.app.get('db');
    let query = db('sessions').where({ repo_id: repoId }).whereNull('archived_at');
    const scopedUserId = params?.user?.id;
    if (scopedUserId != null) {
      query = query.where({ user_id: scopedUserId });
    }
    const sessions = await query;
    for (const session of sessions) {
      // Archive is refused while status is still `provisioning`; wait for the
      // in-process job so repo deletion can finish the session afterwards.
      await this._awaitProvisioning(session.id);
      await this.remove(session.id);
    }
  }

  async remove(id, params) {
    const query = this.options.Model('sessions').where({ id });
    if (params?.provider) {
      query.where({ user_id: params?.user?.id });
    }
    let session = await query.first();
    if (!session) throw new NotFound('Session not found');
    if (session.archived_at) throw new BadRequest('Session already archived');
    if (session.status === PROVISIONING_STATUS) {
      throw new BadRequest('Cannot archive a session while it is still being set up');
    }
    if (this._archivePendingSessionIds.has(id)) {
      throw new BadRequest('Session is already being archived');
    }

    this._archivePendingSessionIds.add(id);
    try {
      if (session.status !== ARCHIVING_STATUS) {
        session = await this.app
          .service('sessions')
          .patch(
            id,
            { status: ARCHIVING_STATUS },
            { provider: undefined, user: { id: session.user_id } }
          );
      }

      await this._stopAgentSession(session);
      await this._stopReviewer(session);
      await this._runCleanupAndFinalize(session);
      return await this.options.Model('sessions').where({ id }).first();
    } finally {
      this._archivePendingSessionIds.delete(id);
    }
  }

  async _runCleanupAndFinalize(session) {
    if (session.worktree_path) {
      const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
      const cleanupCommand = getScriptBlock(baguetteConfig?.session?.cleanup);
      if (cleanupCommand) {
        try {
          await this.app.service('tasks').create(
            {
              session_id: session.id,
              command: cleanupCommand,
              label: 'baguette:cleanup',
              skipInit: true,
              onExit: async () => {
                try {
                  await this._finalizeRemoval(session.id);
                } catch (err) {
                  logger.error(err, 'session deletion error after cleanup');
                }
              },
            },
            { user: { id: session.user_id } }
          );
          return;
        } catch (err) {
          logger.error(err, 'session.cleanup task error');
        }
      }
    }
    await this._finalizeRemoval(session.id);
  }

  async _finalizeRemoval(sessionId) {
    const db = this.app.get('db');
    const session = await db('sessions').where({ id: sessionId }).first();
    const repo = session?.repo_id ? await db('repos').where({ id: session.repo_id }).first() : null;
    if (session?.agent_sdk === 'cursor' && session?.cursor_agent_id) {
      await this.app
        .service('cursor-agent')
        .deleteAgent(session)
        .catch((err) =>
          logger.warn(
            { sessionId, err: err.message },
            'cursor-agent: failed to delete agent on archive'
          )
        );
    }
    if (!isGlobalSession(session)) {
      await removeWorktree(session, repo);
    }
    this.app.service('tasks').deleteSessionTasks(sessionId);
    if (session?.short_id) {
      await removeSessionDockerResources(session.short_id).catch((err) =>
        logger.warn({ err: err.message, sessionId }, 'Failed to remove session docker volume')
      );
    }
    await this._deleteStrongLoopsTiedToSession(sessionId);
    const archivedAt = new Date().toISOString();
    // Only mark archived after the worktree is gone so a later create cannot
    // reuse the branch while files are still on disk.
    await db('sessions')
      .where({ id: sessionId })
      .whereNull('archived_at')
      .update({ archived_at: archivedAt, worktree_path: null, status: ARCHIVED_STATUS });
    const updated = await db('sessions').where({ id: sessionId }).first();
    this.emit('patched', updated);
  }

  /**
   * Strong (session-created) loops live and die with that session. Weak loops stay
   * so the next run can start a replacement session.
   */
  async _deleteStrongLoopsTiedToSession(sessionId) {
    const db = this.app.get('db');
    const tied = await db('loops')
      .where({ session_id: sessionId, created_from_session: true })
      .select('id', 'user_id');
    if (!tied.length) return;
    const loopsService = this.app.services?.loops;
    for (const loop of tied) {
      if (loopsService) {
        await this.app.service('loops').remove(loop.id, { user: { id: loop.user_id } });
      } else {
        await db('loops').where({ id: loop.id }).del();
      }
    }
  }

  _stopAgentSession(session) {
    const service = session.agent_sdk === 'cursor' ? 'cursor-agent' : 'claude-agent';
    return this.app.service(service).stopSession(session.id);
  }

  async _stopReviewer(session) {
    if (!this.app.services?.['session-review']) return;
    try {
      await this.app
        .service('session-review')
        .stop({ session_id: session.id }, { user: { id: session.user_id } });
    } catch (err) {
      logger.warn(
        { sessionId: session.id, err: err.message },
        'Failed to stop session reviewer on archive'
      );
    }
  }

  async _resumeInterruptedReviews() {
    if (!this.app.services?.['session-review']) return;
    try {
      const reviewCounts = await this.app.service('session-review').resumeInterrupted();
      if (reviewCounts && (reviewCounts.resumed || reviewCounts.failed)) {
        logger.info(reviewCounts, 'Recovered interrupted review(s) on startup');
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to resume interrupted reviews on startup');
    }
  }

  async stop(data, params) {
    const session = params.resolvedSession;
    await this._stopAgentSession(session);
    await this.app
      .service('sessions')
      .patch(session.id, { status: 'stopped' }, { user: { id: session.user_id } });
    return { ok: true };
  }

  async commands(data, params) {
    const session = params.resolvedSession;
    if (!session?.worktree_path || isGlobalSession(session)) return { commands: [] };
    const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
    if (baguetteConfig?.error) throw new BadRequest(baguetteConfig.error);
    try {
      return { commands: getAvailableCommands(baguetteConfig) };
    } catch (err) {
      if (err instanceof BaguetteConfigError) throw new BadRequest(err.message);
      throw err;
    }
  }

  async baguetteYaml(_data, params) {
    const session = params.resolvedSession;
    if (!session?.worktree_path || isGlobalSession(session)) {
      return { yaml: null, missing: true };
    }
    const result = await readBaguetteConfigRaw(session.worktree_path);
    if (result.missing) return { yaml: null, missing: true };
    if (result.error) throw new BadRequest(result.error);
    return { yaml: result.yaml, missing: false };
  }

  async previewStatus(_data, params) {
    const session = params.resolvedSession;
    if (!session?.worktree_path) return { services: [] };
    const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
    const definitions = getPreviewServiceDefinitions(baguetteConfig, session.short_id);
    if (!definitions?.length) return { services: [] };

    const tasksService = this.app.service('tasks');
    const services = [];
    for (const def of definitions) {
      const task = tasksService.findLatestTaskByLabel(session.id, def.task_label);
      let status = 'stopped';
      let task_id = null;
      let exit_code = null;
      const ports = {};

      if (task) {
        task_id = task.id;
        if (task.status === 'running') {
          const exposePort = def.expose ? task.ports[def.expose] : null;
          if (exposePort && (await isPortListening(exposePort))) {
            status = 'ready';
          } else {
            status = 'starting';
          }
          for (const [envVar, port] of Object.entries(task.ports)) {
            ports[envVar] = { port, listening: await isPortListening(port) };
          }
        } else {
          exit_code = task.exit_code;
          // A task we killed (Stop button, idle TTL) is stopped, not crashed, whatever the
          // exit code its child reported on SIGTERM.
          const killed = !!task.kill_reason;
          status = !killed && exit_code != null && exit_code !== 0 ? 'crashed' : 'stopped';
        }
      }

      let allowed_ip = null;
      if (
        session.is_preview_ip_public &&
        (status === 'ready' || status === 'starting') &&
        def.url
      ) {
        const key = this._previewServiceProxyKey(session, def.name, baguetteConfig);
        const proxyState = key ? this.app.get('devProxy')?.states.get(key) : null;
        allowed_ip = proxyState?.starterIp ?? null;
      }

      services.push({
        name: def.name,
        display_name: def.display_name,
        description: def.description ?? null,
        url: def.url,
        deep_link_url: def.deep_link_url,
        expose: def.expose,
        task_key: def.task_key,
        task_label: def.task_label,
        task_id,
        status,
        exit_code,
        ports,
        allowed_ip,
      });
    }
    return { services };
  }

  _previewServiceProxyKey(session, serviceName, baguetteConfig) {
    const definitions = getPreviewServiceDefinitions(baguetteConfig, session.short_id);
    const def = definitions?.find((d) => d.name === serviceName);
    if (!def?.url) return null;
    try {
      return new URL(def.url).hostname;
    } catch {
      return null;
    }
  }

  _attachPreviewServiceToDevProxy(session, serviceName, baguetteConfig, task, params) {
    const key = this._previewServiceProxyKey(session, serviceName, baguetteConfig);
    const webserverConfig = resolvePreviewServiceConfig(baguetteConfig, serviceName);
    if (!key || !webserverConfig?.expose) return;
    const devProxy = this.app.get('devProxy');
    devProxy?.attachWebserverTask(key, task, webserverConfig.expose, {
      starterIp: params.clientIp ?? null,
    });
  }

  async startPreviewService(data, params) {
    const session = params.resolvedSession;
    if (!session?.worktree_path) throw new BadRequest('Session has no worktree');
    const serviceName = data?.service ?? 'default';
    const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
    const webserverConfig = resolvePreviewServiceConfig(baguetteConfig, serviceName);
    if (!webserverConfig) {
      throw new BadRequest(`No preview service "${serviceName}" configured`);
    }

    const label = `baguette:webserver:${serviceName}`;
    const tasksService = this.app.service('tasks');
    // Start clears then starts, like the preview page's Retry button: stop whatever task is
    // running for this service and boot a fresh one (attaching it below drops the old proxy
    // state and its logs).
    const running = tasksService._findRunningTask(session.id, label);
    if (running) await running.kill();

    const created = await tasksService.create(
      {
        session_id: session.id,
        label,
        // A `webserver.task` reference resolves through the config; an inline
        // `webserver.command` has no task to name, so pass the command directly.
        ...(webserverConfig.taskKey
          ? { task_key: webserverConfig.taskKey }
          : {
              command: webserverConfig.command,
              ports: Array.isArray(webserverConfig.ports) ? webserverConfig.ports : [],
            }),
        ttl_ms: PREVIEW_WEBSERVICE_TTL_MS,
      },
      // Internal call: forwarding the REST/socket `provider` would let tasks.create
      // strip `ttl_ms` via the `only()` hook.
      { user: params.user, clientIp: params.clientIp }
    );
    const task = tasksService.getTask(created.id);
    if (task) {
      this._attachPreviewServiceToDevProxy(session, serviceName, baguetteConfig, task, params);
    }
    return created;
  }

  async diff(data, params) {
    const session = params.resolvedSession;
    if (!session?.worktree_path || isGlobalSession(session)) return { diff: '' };
    const cwd = resolveDataDirRelativePath(session.worktree_path);
    try {
      const user = await this.app.service('users').get(session.user_id, {});
      const token = getGithubToken(user);
      const currentBranch = session.remote_branch || session.local_branch;
      await Promise.all([
        session.base_branch ? gitFetch(cwd, token, session.base_branch).catch(() => {}) : null,
        currentBranch && currentBranch !== session.base_branch
          ? gitFetch(cwd, token, currentBranch).catch(() => {})
          : null,
      ]);
      const commitSha =
        data && typeof data === 'object' && data.commit && data.commit !== 'all'
          ? String(data.commit)
          : null;
      const diffFn = commitSha
        ? () => gitShowCommitDiff(cwd, commitSha)
        : () => gitDiff(cwd, session.base_branch);
      const [diff, hasUncommitted, commitsToPush, { localSha, remoteSha }] = await Promise.all([
        diffFn(),
        gitHasUncommitted(cwd),
        gitCommitsToPush(cwd, currentBranch),
        gitLocalAndRemoteSha(cwd, currentBranch),
      ]);
      return { diff, hasUncommitted, commitsToPush, localSha, remoteSha, commit: commitSha };
    } catch (err) {
      return { diff: '', hasUncommitted: false, error: err.message };
    }
  }

  async changedFiles(data, params) {
    const session = params.resolvedSession;
    if (!session?.worktree_path || isGlobalSession(session)) {
      return { files: [], commit: null };
    }
    const cwd = resolveDataDirRelativePath(session.worktree_path);
    const commitSha =
      data && typeof data === 'object' && data.commit && data.commit !== 'all'
        ? String(data.commit)
        : null;
    try {
      if (!commitSha && session.base_branch) {
        const user = await this.app.service('users').get(session.user_id, {});
        const token = getGithubToken(user);
        await gitFetch(cwd, token, session.base_branch).catch(() => {});
      }
      const files = commitSha
        ? await gitShowCommitNumstat(cwd, commitSha)
        : await gitDiffNumstat(cwd, session.base_branch);
      return { files, commit: commitSha };
    } catch (err) {
      return { files: [], commit: commitSha, error: err.message };
    }
  }

  async sessionGitStatus(_data, params) {
    const session = params.resolvedSession;
    return computeSessionGitStatus(session);
  }

  async getSessionByShortId(data, params) {
    const shortId = typeof data?.short_id === 'string' ? data.short_id.trim() : '';
    if (!shortId) throw new BadRequest('short_id is required');
    const userId = params.user?.id;
    const db = this.app.get('db');
    const row = await db('sessions').where({ short_id: shortId, user_id: userId }).first();
    if (!row) throw new NotFound('Session not found');
    const [openIssues, runningTasksList] = await Promise.all([
      db('session_issues').where({ session_id: row.id, status: 'opened' }).count('* as count'),
      this.app.service('tasks').find({
        query: { session_id: row.id, status: 'running' },
        user: params.user,
      }),
    ]);
    const running_tasks_count = Array.isArray(runningTasksList) ? runningTasksList.length : 0;
    return {
      ...row,
      open_issues_count: Number(openIssues[0]?.count ?? 0),
      running_tasks_count,
    };
  }

  async sessionUsage(_data, params) {
    const session = params.resolvedSession;
    const db = this.app.get('db');
    const rows = await db('usage')
      .where({ session_id: session.id })
      .select(
        db.raw("CASE WHEN kind = 'review' THEN 'review' ELSE 'session' END as usage_kind"),
        'model',
        'agent_sdk'
      )
      .sum('cost_usd as cost_usd')
      .sum('input_tokens as input_tokens')
      .sum('output_tokens as output_tokens')
      .sum('cache_read_tokens as cache_read_tokens')
      .sum('cache_write_tokens as cache_write_tokens')
      .sum('total_tokens as total_tokens')
      .groupByRaw("CASE WHEN kind = 'review' THEN 'review' ELSE 'session' END, model, agent_sdk")
      .orderBy('usage_kind')
      .orderBy('model');

    const breakdown = rows.map((r) => ({
      kind: r.usage_kind === 'review' ? 'review' : 'session',
      model: r.model || 'unknown',
      agent_sdk: r.agent_sdk || 'claude',
      cost_usd: parseFloat(r.cost_usd ?? 0),
      input_tokens: Number(r.input_tokens ?? 0),
      output_tokens: Number(r.output_tokens ?? 0),
      cache_read_tokens: Number(r.cache_read_tokens ?? 0),
      cache_write_tokens: Number(r.cache_write_tokens ?? 0),
      total_tokens: Number(r.total_tokens ?? 0),
    }));

    const totals = breakdown.reduce(
      (acc, row) => ({
        total_tokens: acc.total_tokens + row.total_tokens,
        cost_usd: acc.cost_usd + row.cost_usd,
        input_tokens: acc.input_tokens + row.input_tokens,
        output_tokens: acc.output_tokens + row.output_tokens,
      }),
      { total_tokens: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 }
    );

    return { totals, breakdown };
  }

  async branchCommits(_data, params) {
    const session = params.resolvedSession;
    if (!session?.worktree_path || isGlobalSession(session)) {
      return { commits: [] };
    }
    const cwd = resolveDataDirRelativePath(session.worktree_path);
    try {
      const user = await this.app.service('users').get(session.user_id, {});
      const token = getGithubToken(user);
      const currentBranch = session.remote_branch || session.local_branch;
      await Promise.all([
        session.base_branch ? gitFetch(cwd, token, session.base_branch).catch(() => {}) : null,
        currentBranch && currentBranch !== session.base_branch
          ? gitFetch(cwd, token, currentBranch).catch(() => {})
          : null,
      ]);
      const commits = await gitLogSinceBase(cwd, session.base_branch);
      return { commits };
    } catch (err) {
      return { commits: [], error: err.message };
    }
  }

  async shas(data, params) {
    const session = params.resolvedSession;
    if (!session?.worktree_path || isGlobalSession(session)) {
      return { localSha: null, remoteSha: null };
    }
    const cwd = resolveDataDirRelativePath(session.worktree_path);
    try {
      const user = await this.app.service('users').get(session.user_id, {});
      const token = getGithubToken(user);
      const branch = data.branch || session.remote_branch || session.local_branch;
      if (branch) await gitFetch(cwd, token, branch).catch(() => {});
      return await gitLocalAndRemoteSha(cwd, branch || null);
    } catch (err) {
      return { localSha: null, remoteSha: null, error: err.message };
    }
  }

  async showDiff(data, params) {
    const session = params.resolvedSession;
    if (!session?.worktree_path || isGlobalSession(session)) return { path: data.path, diff: '' };
    const cwd = resolveDataDirRelativePath(session.worktree_path);
    try {
      const diff = await gitDiff(cwd, session.base_branch, {
        filePath: data.path,
      });
      return { path: data.path, diff };
    } catch (err) {
      return { path: data.path, diff: '', error: err.message };
    }
  }

  async merge(data, params) {
    const session = params.resolvedSession;
    if (!session?.pr_number) throw new BadRequest('No PR to merge');
    const user = await this.app.service('users').get(session.user_id, {});
    const token = getGithubToken(user);
    if (!token) throw new BadRequest('No GitHub token configured');
    if (session.pr_status === 'draft') {
      await markPRReady(token, session.repo_full_name, session.pr_number);
    }
    await mergePR(token, session.repo_full_name, session.pr_number);
    await this.app
      .service('sessions')
      .patch(
        session.id,
        { pr_status: 'merged' },
        { provider: undefined, user: { id: session.user_id } }
      );
    if (data?.archive) {
      try {
        await this.remove(session.id, params);
      } catch (err) {
        const detail = err?.message || 'Unknown error';
        throw new BadRequest(
          `Pull request merged successfully, but archiving the session failed: ${detail}`
        );
      }
    }
    return { ok: true, merged: true, archived: !!data?.archive };
  }

  async setPrDraft(data, params) {
    const session = params.resolvedSession;
    if (!session?.pr_number) throw new BadRequest('No pull request');
    const draft = data?.draft;
    if (typeof draft !== 'boolean') throw new BadRequest('draft must be a boolean');
    const status = session.pr_status ?? 'open';
    if (status === 'merged' || status === 'closed') {
      throw new BadRequest('Cannot change draft status for a closed pull request');
    }
    const user = await this.app.service('users').get(session.user_id, {});
    const token = getGithubToken(user);
    if (!token) throw new BadRequest('No GitHub token configured');
    if (draft) {
      await markPRDraft(token, session.repo_full_name, session.pr_number);
    } else {
      await markPRReady(token, session.repo_full_name, session.pr_number);
    }
    const pr_status = draft ? 'draft' : 'open';
    await this.app
      .service('sessions')
      .patch(session.id, { pr_status }, { provider: undefined, user: { id: session.user_id } });
    return { ok: true, pr_status };
  }

  async push(data, params) {
    const session = params.resolvedSession;
    if (isGlobalSession(session)) throw new BadRequest('Global sessions cannot push');
    if (!session?.worktree_path) throw new BadRequest('Session has no worktree');
    const cwd = resolveDataDirRelativePath(session.worktree_path);
    const user = await this.app.service('users').get(session.user_id, {});
    const token = getGithubToken(user);
    if (!token) throw new BadRequest('No GitHub token configured');
    const forceMode = data?.forceMode ?? (data?.force ? 'lease' : null);
    const branch = data?.branch || session.remote_branch || session.local_branch || null;
    let pushedBranch;
    try {
      const result = await gitPush(cwd, token, {
        branch,
        force: forceMode === 'lease',
        forceOverwrite: forceMode === 'force',
      });
      pushedBranch = result.branch;
      await this.app
        .service('sessions')
        .patch(
          session.id,
          { remote_branch: pushedBranch },
          { provider: undefined, user: { id: session.user_id } }
        );
    } catch (err) {
      if (err.rejected) {
        const conflict = new BadRequest('Push failed due to a conflict');
        conflict.data = { conflict: true };
        throw conflict;
      }
      throw err;
    }
    if (session.label || session.pr_description != null) {
      const head = pushedBranch || session.remote_branch || session.local_branch;
      let userPrefix = '';
      if (session.pr_number) {
        try {
          const existingPr = await getOpenPRByNumber(
            token,
            session.repo_full_name,
            session.pr_number
          );
          userPrefix = splitPrBody(existingPr?.body ?? '').userPrefix;
        } catch {
          // non-fatal — proceed without user prefix
        }
      }
      const baguetteConfig = session.worktree_path
        ? await loadBaguetteConfig(resolveDataDirRelativePath(session.worktree_path))
        : null;
      const previewUrl = getSessionPreviewUrl(session, baguetteConfig);
      const usageLines = await loadSessionFooterUsageLines(this.app.get('db'), session);
      const pr = await upsertPR(token, {
        repoFullName: session.repo_full_name,
        prNumber: session.pr_number,
        title: session.label || session.repo_full_name,
        body: buildPrBody(
          userPrefix,
          session.pr_description ?? '',
          buildSessionFooter(session, { previewUrl, usageLines })
        ),
        head: session.pr_number ? undefined : head,
        baseBranch: session.base_branch,
      });
      if (!session.pr_number) {
        await this.app
          .service('sessions')
          .patch(
            session.id,
            { pr_url: pr.url, pr_number: pr.number, pr_status: 'open' },
            { provider: undefined, user: { id: session.user_id } }
          );
      }
    }
    return { ok: true };
  }

  async getPrDetails(data, params) {
    const session = params.resolvedSession;
    if (!session?.pr_number) throw new BadRequest('Session has no PR');
    const user = await this.app.service('users').get(session.user_id, {});
    const token = getGithubToken(user);
    if (!token) throw new BadRequest('No GitHub token configured');
    const pr = await getOpenPRByNumber(token, session.repo_full_name, session.pr_number);
    return { title: pr.title, body: pr.body ?? '' };
  }

  async restore(data, params) {
    const session = params.resolvedSession;
    if (!session.archived_at) {
      throw new BadRequest('Can only restore archived sessions');
    }

    const db = this.app.get('db');

    // Check if worktree still exists
    const resolvedPath = session.worktree_path
      ? resolveDataDirRelativePath(session.worktree_path)
      : null;
    const worktreeExists = resolvedPath
      ? await fs
          .access(resolvedPath)
          .then(() => true)
          .catch(() => false)
      : false;

    const dbUpdate = { archived_at: null, status: 'stopped' };

    if (isGlobalSession(session)) {
      dbUpdate.worktree_path = 'repos';
    } else if (!worktreeExists) {
      const repo = session.repo_id
        ? await db('repos').where({ id: session.repo_id }).first()
        : null;
      if (!repo) throw new BadRequest('Session has no associated repository');
      const user = await this.app.service('users').get(session.user_id, {});
      const token = getGithubToken(user);
      if (!token) throw new BadRequest('No GitHub token configured');

      const branch = session.remote_branch || session.local_branch;
      if (!branch) throw new BadRequest('Session has no branch to restore to');
      const localBranch =
        session.local_branch || uniqueLocalBranch(branch, session.short_id) || branch;

      const { worktreePath: absoluteWorktreePath } = await createWorktree(
        repo,
        branch,
        session.short_id,
        token,
        { localBranch, baseBranch: session.base_branch }
      );
      dbUpdate.local_branch = localBranch;
      await configureWorktreeGitIdentity(absoluteWorktreePath, user);
      dbUpdate.worktree_path = path.relative(DATA_DIR, absoluteWorktreePath);
    }

    await db('sessions').where({ id: session.id }).update(dbUpdate);

    await this.app.service('messages').create(
      {
        session_id: session.id,
        type: 'system',
        subtype: 'status',
        message_json: JSON.stringify({
          type: 'system',
          subtype: 'status',
          status: worktreeExists ? 'Session restored' : 'Session restored — worktree recreated',
        }),
      },
      { user: { id: session.user_id } }
    );

    const updated = await db('sessions').where({ id: session.id }).first();
    this.emit('patched', updated);

    return { ok: true };
  }

  async onMessageCreated(message) {
    const sessionId = message.session_id;
    if (!sessionId) return;
    if (message.type !== 'user' && message.type !== 'result') return;

    let status;
    let result = null;
    if (message.type === 'user') {
      status = 'running';
    } else if (message.type === 'result') {
      const subtype = message.subtype;
      status = 'failed';
      try {
        const parsed = JSON.parse(message.message_json || '{}');
        if (subtype === 'success' && !parsed.is_error) status = 'completed';
        result = parsed;
      } catch {
        /* invalid agent result JSON */
      }
    }

    const db = this.app.get('db');
    const session = await db('sessions').where({ id: sessionId }).first();
    if (!session) return;
    if (
      session.archived_at ||
      session.status === ARCHIVING_STATUS ||
      session.status === ARCHIVED_STATUS
    )
      return;

    const patch = {};
    if (status !== undefined && session.status !== status) patch.status = status;

    if (result !== null) {
      const costUpdate = await this.recordClaudeUsage(session, result);
      if (costUpdate > 0) {
        patch.total_cost_usd = parseFloat(session.total_cost_usd ?? 0) + costUpdate;
      }
    }

    if (Object.keys(patch).length === 0) return;
    await this.app.service('sessions').patch(sessionId, patch, {
      provider: undefined,
      user: { id: session.user_id },
    });
  }

  /**
   * Incremental Claude cost/tokens for one SDK `result`. Chat goes through
   * `onMessageCreated`; review results never land on `messages`, so review
   * calls this directly with `{ kind: 'review', totalsKey }`.
   *
   * `total_cost_usd` and `modelUsage` are running totals for the query, so this
   * turn's share is the difference from the last result for `totalsKey`. See
   * server/services/turn-usage.js.
   *
   * @returns {Promise<number>} cost delta to add to `sessions.total_cost_usd`
   */
  async recordClaudeUsage(session, result, { kind, model, totalsKey, patchSessionCost } = {}) {
    if (!session || !result) return 0;
    const key = totalsKey ?? session.id;
    const prev = this._lastResultTotals.get(key) ?? { cost: 0, models: {} };
    const costUpdate = delta(prev.cost, result.total_cost_usd);
    const turnUsage = diffModelUsage(prev.models, result.modelUsage);
    this._lastResultTotals.set(key, {
      cost: Number(result.total_cost_usd) || 0,
      models: result.modelUsage ?? {},
    });
    if (costUpdate <= 0 && turnUsage.total_tokens <= 0) return 0;

    const db = this.app.get('db');
    const row = {
      session_id: session.id,
      user_id: session.user_id,
      repo_full_name: session.repo_full_name,
      cost_usd: Math.max(costUpdate, 0),
      agent_sdk: session.agent_sdk || 'claude',
      input_tokens: turnUsage.input_tokens,
      output_tokens: turnUsage.output_tokens,
      cache_read_tokens: turnUsage.cache_read_tokens,
      cache_write_tokens: turnUsage.cache_write_tokens,
      reasoning_tokens: turnUsage.reasoning_tokens,
      total_tokens: turnUsage.total_tokens,
      model: turnUsage.model ?? model ?? session.model ?? null,
    };
    if (kind) row.kind = kind;
    await db('usage').insert(row);

    if (patchSessionCost && costUpdate > 0) {
      const latest = await db('sessions').where({ id: session.id }).first();
      await this.app
        .service('sessions')
        .patch(
          session.id,
          { total_cost_usd: parseFloat(latest?.total_cost_usd ?? 0) + costUpdate },
          { provider: undefined, user: { id: session.user_id } }
        );
    }
    return costUpdate;
  }

  resetClaudeUsageTotals(totalsKey) {
    this._lastResultTotals.delete(totalsKey);
  }

  async onTurnComplete(sessionId) {
    const db = this.app.get('db');
    const session = await db('sessions').where({ id: sessionId }).first();
    if (session) {
      this.emit('turn:complete', { session_id: sessionId, user_id: session.user_id });
    }
    const queued = await db('queued_messages')
      .where({ session_id: sessionId, kind: 'turn' })
      .orderBy('created_at', 'asc')
      .first();
    if (!queued) return;
    await this.app.service('queued-messages').remove(queued.id, {
      user: { id: queued.user_id },
    });
    await this.app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: queued.message_json,
        ...turnModelCreateFields(queued),
      },
      { user: { id: queued.user_id } }
    );
  }
}

async function requireOwnSession(context) {
  const db = context.app.get('db');
  const id = context.id;
  const userId = context.params.user?.id;
  if (id == null) return context; // multi-patch, skip
  // Internal calls may patch without params.user (e.g. system status updates).
  // `requireUser` already enforces auth for external providers.
  if (!userId) return context;
  const session = await db('sessions').where({ id, user_id: userId }).first();
  if (!session) throw new NotFound('Session not found');
  // Clear params.knex: scopeByUser set it to a SELECT builder which gets consumed
  // by _patch's UPDATE step, causing _findOrGet to return 0 rows. Ownership is
  // already verified above, so the plain id-based query in _patch is sufficient.
  delete context.params.knex;
  return context;
}

async function ensureShortId(context) {
  if (!context.data.short_id) {
    context.data.short_id = crypto.randomBytes(4).toString('hex');
  }
  return context;
}

function seedLastActivityOnCreate(context) {
  if (!context.data.last_activity_at) {
    context.data.last_activity_at = new Date().toISOString();
  }
  return context;
}

function sanitizeBranchName(requestedName, fallbackBranch) {
  if (!requestedName) return fallbackBranch;
  return (
    requestedName
      .toLowerCase()
      .replace(/[^a-z0-9/_.-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || fallbackBranch
  );
}

/** Fast checks and DB fields only — worktree/git/github run in {@link provisionSessionEnvironment}. */
async function validateSessionCreate(context) {
  const createNewBranch = context.data.create_new_branch ?? true;
  context.params._createNewBranch = createNewBranch;

  const isGlobal = !!context.data.is_global || !context.data.repo_full_name;
  if (isGlobal) {
    context.data.is_global = true;
    context.data.repo_id = null;
    context.data.repo_full_name = '';
    context.data.base_branch = '';
    context.data.auto_push = false;
    context.data.status = PROVISIONING_STATUS;
    delete context.data.create_new_branch;
    delete context.data.branch_name;
    return context;
  }

  const { repo_full_name: repoFullName, base_branch: baseBranch } = context.data;

  const db = context.app.get('db');
  const repo = await db('repos').where({ full_name: repoFullName }).first();
  if (!repo) {
    throw new BadRequest(`Repository "${repoFullName}" is not registered`);
  }

  const shortId = context.data.short_id;
  const branchPrefix = context.params.user?.branch_prefix ?? '';
  const fallbackBranch = taskBranchForShortId(branchPrefix, shortId);

  if (context.data.branch_name) {
    context.params._requestedBranchName = context.data.branch_name;
    delete context.data.branch_name;
  }
  delete context.data.create_new_branch;

  context.data.repo_id = repo.id;
  context.data.status = PROVISIONING_STATUS;

  if (!createNewBranch) {
    const workingBranch = baseBranch;
    if (!workingBranch) {
      throw new BadRequest('base_branch is required when continuing an existing branch');
    }
    context.data.remote_branch = workingBranch;
    context.data.local_branch = uniqueLocalBranch(workingBranch, shortId);
  } else if (context.params._requestedBranchName) {
    const branchName = sanitizeBranchName(context.params._requestedBranchName, fallbackBranch);
    context.data.remote_branch = branchName;
    context.data.local_branch = uniqueLocalBranch(branchName, shortId);
  }

  return context;
}

function hasInitialPrompt(prompt) {
  return typeof prompt === 'string' && prompt.trim().length > 0;
}

function defaultSessionLabelWithoutPrompt(shortId) {
  return `New session (${shortId})`;
}

function taskBranchForShortId(branchPrefix, shortId) {
  return `${branchPrefix}task-${shortId}`;
}

async function provisionGlobalSession(app, session, params) {
  const userParams = { provider: undefined, user: params.user };
  const patch = {
    worktree_path: 'repos',
    auto_push: false,
    is_global: true,
  };
  if (hasInitialPrompt(session.initial_prompt)) {
    try {
      const agentService = session.agent_sdk === 'cursor' ? 'cursor-agent' : 'claude-agent';
      const result = await app
        .service(agentService)
        .generateSessionMetadata(session.initial_prompt, session.short_id, params.user, null);
      if (result.label) patch.label = result.label;
    } catch (err) {
      logger.error(err, 'Metadata generation error (non-fatal)');
    }
    if (!patch.label) patch.label = 'Global session';
  } else {
    patch.label = defaultSessionLabelWithoutPrompt(session.short_id);
  }
  return await app.service('sessions').patch(session.id, patch, userParams);
}

async function provisionSessionEnvironment(app, session, params) {
  if (isGlobalSession(session) || !session.repo_full_name) {
    return provisionGlobalSession(app, session, params);
  }

  const { user, createNewBranch, requestedBranchName } = params;
  const continueExistingBranch = !createNewBranch;
  const { repo_full_name: repoFullName, base_branch: baseBranch, short_id: shortId } = session;
  if (!repoFullName) return session;

  const db = app.get('db');
  const token = getGithubToken(user);
  const repo = await db('repos').where({ full_name: repoFullName }).first();
  if (!repo) throw new BadRequest(`Repository "${repoFullName}" is not registered`);

  const userParams = { provider: undefined, user };
  let patch = {};

  if (continueExistingBranch) {
    const workingBranch = baseBranch;
    const defaultForDiff = repo.default_branch || 'main';
    let openPr = null;
    try {
      openPr = await getOpenPR(token, repoFullName, workingBranch);
    } catch (err) {
      logger.error(err, 'getOpenPR during continue-existing-branch session (non-fatal)');
    }
    const baseBranchForWorktree = openPr?.base_ref ?? defaultForDiff;

    const localBranch =
      session.local_branch || uniqueLocalBranch(workingBranch, shortId) || workingBranch;
    const { worktreePath: absoluteWorktreePath } = await createWorktree(
      repo,
      workingBranch,
      shortId,
      token,
      { localBranch, baseBranch: baseBranchForWorktree }
    );
    await configureWorktreeGitIdentity(absoluteWorktreePath, user);
    patch = {
      worktree_path: path.relative(DATA_DIR, absoluteWorktreePath),
      local_branch: localBranch,
      remote_branch: workingBranch,
    };

    if (openPr) {
      Object.assign(patch, {
        base_branch: openPr.base_ref,
        pr_url: openPr.html_url,
        pr_number: openPr.number,
        pr_status: openPr.draft ? 'draft' : 'open',
        label: openPr.title,
        pr_description: openPr.body ?? null,
      });
    } else {
      patch.base_branch = defaultForDiff;
      patch.label = `Continuing: ${workingBranch}`;
    }
  } else {
    const { worktreePath: absoluteWorktreePath } = await createWorktree(
      repo,
      baseBranch,
      shortId,
      token
    );
    await configureWorktreeGitIdentity(absoluteWorktreePath, user);
    patch.worktree_path = path.relative(DATA_DIR, absoluteWorktreePath);

    const branchPrefix = user?.branch_prefix ?? '';
    const fallbackBranch = taskBranchForShortId(branchPrefix, shortId);
    let remoteName =
      session.remote_branch || sanitizeBranchName(requestedBranchName, fallbackBranch);
    if (hasInitialPrompt(session.initial_prompt)) {
      try {
        const agentService = session.agent_sdk === 'cursor' ? 'cursor-agent' : 'claude-agent';
        const result = await app
          .service(agentService)
          .generateSessionMetadata(session.initial_prompt, shortId, user, repo);
        if (result.label) patch.label = result.label;
        if (!requestedBranchName && !session.remote_branch) {
          remoteName = result.branchName ? `${branchPrefix}${result.branchName}` : fallbackBranch;
        }
      } catch (err) {
        logger.error(err, 'Metadata generation error (non-fatal)');
      }
    } else {
      patch.label = defaultSessionLabelWithoutPrompt(shortId);
      if (!requestedBranchName && !session.remote_branch) {
        remoteName = fallbackBranch;
      }
    }
    let localBranch = session.local_branch || uniqueLocalBranch(remoteName, shortId) || remoteName;
    try {
      await execFileAsync('git', ['checkout', '-b', localBranch], {
        cwd: absoluteWorktreePath,
        stdio: 'pipe',
      });
    } catch {
      remoteName = fallbackBranch;
      localBranch = uniqueLocalBranch(fallbackBranch, shortId) || fallbackBranch;
      await execFileAsync('git', ['checkout', '-b', localBranch], {
        cwd: absoluteWorktreePath,
        stdio: 'pipe',
      });
    }
    await trySetBranchUpstream(absoluteWorktreePath, localBranch, remoteName);
    patch.local_branch = localBranch;
    patch.remote_branch = remoteName;
  }

  return await app.service('sessions').patch(session.id, patch, userParams);
}

async function finalizeSessionAfterProvision(app, session, params) {
  const enriched = await withHasWebserver(session);
  const promptContext = {
    app,
    result: enriched,
    params: {
      user: params.user,
      initialFiles: params.initialFiles,
      skipFirstMessage: params.skipFirstMessage,
    },
  };
  await persistSystemPrompt(promptContext);
  await createFirstMessage(promptContext);
  // Messages sent while the worktree was still being created were queued; flush
  // the first one now that the session can actually run.
  await app.service('sessions').onTurnComplete(session.id);
  const row = await app.get('db')('sessions').where({ id: session.id }).first();
  if (row?.status === PROVISIONING_STATUS) {
    await app
      .service('sessions')
      .patch(session.id, { status: 'stopped' }, { provider: undefined, user: params.user });
  }
}

async function failSessionProvisioning(app, sessionId, user, err) {
  logger.error({ err, sessionId }, 'Session provisioning failed');
  const userParams = { provider: undefined, user };
  const message = err?.message || 'Session setup failed';
  try {
    const db = app.get('db');
    const session = await db('sessions').where({ id: sessionId }).first();
    if (session && !session.archived_at) {
      const repo = session.repo_id
        ? await db('repos').where({ id: session.repo_id }).first()
        : null;
      await removeWorktree(session, repo).catch((rmErr) =>
        logger.warn({ err: rmErr, sessionId }, 'Failed to remove worktree after provisioning error')
      );
    }
    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'system',
        subtype: 'status',
        message_json: JSON.stringify({
          type: 'system',
          subtype: 'status',
          status: `Setup failed — ${message}`,
        }),
      },
      userParams
    );
    await app
      .service('sessions')
      .patch(sessionId, { status: 'failed', worktree_path: null }, userParams);
  } catch (patchErr) {
    logger.error(
      { err: patchErr, sessionId },
      'Failed to mark session as failed after setup error'
    );
  }
}

async function scheduleSessionProvisioning(context) {
  const session = context.result;
  if (!session) return context;
  if (!session.repo_full_name && !isGlobalSession(session)) return context;

  const params = {
    user: context.params.user,
    initialFiles: context.params.initialFiles,
    createNewBranch: context.params._createNewBranch ?? true,
    requestedBranchName: context.params._requestedBranchName,
    skipFirstMessage: context.params.skipFirstMessage,
  };

  const run = async () => {
    try {
      const provisioned = await provisionSessionEnvironment(context.app, session, params);
      await finalizeSessionAfterProvision(context.app, provisioned, params);
      return {
        session:
          (await context.app.get('db')('sessions').where({ id: session.id }).first()) ||
          provisioned,
      };
    } catch (err) {
      await failSessionProvisioning(context.app, session.id, params.user, err);
      return { error: err };
    }
  };

  const sessionsService = context.app.service('sessions');
  const promise = run();
  sessionsService._trackProvisioning(session.id, promise);

  // REST/socket clients return as soon as the row exists. Tests and internal
  // callers (loops) still wait so they observe the provisioned session or a thrown error.
  const waitForProvision =
    context.params.syncProvision ?? (!context.params.provider || process.env.VITEST);

  if (waitForProvision) {
    const outcome = await promise;
    if (outcome.error) throw outcome.error;
    if (outcome.session) context.result = outcome.session;
  }
  return context;
}

export async function resolveSessionFromData(context) {
  // context.data may be a plain session ID or an object with an `id` field
  const sessionId = context.data?.id ?? context.data;
  const session = await context.service.get(sessionId, { user: context.params.user });
  context.params.resolvedSession = session;
  return context;
}

async function withHasWebserver(session) {
  if (!session) return session;
  const resolvedPath = resolveDataDirRelativePath(session.worktree_path);
  const absoluteWorktreePath = resolvedPath
    ? await fs.realpath(resolvedPath).catch(() => resolvedPath)
    : resolvedPath;
  const config = session.worktree_path ? await loadBaguetteConfig(session.worktree_path) : null;
  const hasPreview = sessionHasPreviewConfig(config);
  const previewServices =
    hasPreview && session.short_id ? getPreviewServiceDefinitions(config, session.short_id) : null;
  return {
    ...session,
    absolute_worktree_path: absoluteWorktreePath ?? null,
    preview_url: hasPreview && getPreviewHost(session.short_id),
    preview_services: previewServices,
    is_preview_public: hasPreview ? !!session.is_preview_public : false,
    is_preview_ip_public: hasPreview ? !!session.is_preview_ip_public : false,
    is_preview_users_public: hasPreview ? (session.is_preview_users_public ?? true) : false,
    is_global: Boolean(session.is_global),
    codeserver_url:
      absoluteWorktreePath && !isGlobalSession(session)
        ? getCodeserverUrl(absoluteWorktreePath)
        : null,
  };
}

async function addHasWebserver(context) {
  const result = context.result;
  if (!result) return context;
  if (Array.isArray(result?.data)) {
    context.result = { ...result, data: await Promise.all(result.data.map(withHasWebserver)) };
  } else if (Array.isArray(result)) {
    context.result = await Promise.all(result.map(withHasWebserver));
  } else {
    context.result = await withHasWebserver(result);
  }
  return context;
}

async function syncSessionSettingsAfterPatch(context) {
  if (context.id != null && context.result) {
    // Only sync settings for Claude sessions (Cursor SDK handles model/mode per-send)
    if (context.result.agent_sdk !== 'cursor') {
      await context.app
        .service('claude-agent')
        .syncSessionSettingsFromPatch(context.id, context.result);
    }
  }
  return context;
}

function extractInitialFiles(context) {
  const files = context.data.initial_files;
  if (files) {
    context.params.initialFiles = files;
    delete context.data.initial_files;
  }
  return context;
}

function serializePlugins(context) {
  const plugins = context.data.plugins;
  if (Array.isArray(plugins)) {
    context.data.plugins = JSON.stringify(plugins);
  } else if (plugins == null) {
    delete context.data.plugins;
  }
  return context;
}

function normalizeModelFields(context) {
  const { model } = context.data;
  if (!model) return context;
  // Handle legacy JSON-encoded cursor model field: {"id": "...", "params": [...]}
  try {
    const parsed = JSON.parse(model);
    if (parsed?.id) {
      context.data.model = parsed.id;
      if (parsed.params?.length) {
        context.data.model_params = JSON.stringify(parsed.params);
      }
    }
  } catch {
    /* plain string, no-op */
  }
  return context;
}

/** Reviewer starts from the session's SDK/model; later edits write review_* only. */
function seedReviewModelFromSession(context) {
  if (context.data.review_agent_sdk === undefined) {
    context.data.review_agent_sdk = context.data.agent_sdk || 'claude';
  }
  if (context.data.review_model === undefined) {
    context.data.review_model = context.data.model ?? null;
  }
  if (context.data.review_model_params === undefined) {
    context.data.review_model_params = context.data.model_params ?? null;
  }
  return context;
}

export function registerSessionsService(app, path = 'sessions') {
  const options = {
    Model: app.get('db'),
    name: 'sessions',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  app.use(path, new SessionsService(options), {
    events: ['app:error', 'push:request', 'turn:complete'],
    methods: [
      'find',
      'get',
      'create',
      'patch',
      'remove',
      'stop',
      'commands',
      'baguetteYaml',
      'diff',
      'changedFiles',
      'sessionGitStatus',
      'getSessionByShortId',
      'sessionUsage',
      'branchCommits',
      'shas',
      'showDiff',
      'merge',
      'setPrDraft',
      'push',
      'restore',
      'getPrDetails',
      'previewStatus',
      'startPreviewService',
    ],
  });
  app.service(path).hooks(sessionsHooks);
}

function sqliteBool(value) {
  if (queryFlagEnabled(value)) return 1;
  if (queryFlagDisabled(value)) return 0;
  return value;
}

/** Pull list-only flags off the query so they are not treated as session columns. */
function sanitizeSessionFindQuery(context) {
  if (context.method !== 'find') return context;
  const query = context.params.query || {};
  const filters = {};
  for (const key of SESSION_LIST_QUERY_FLAGS) {
    if (key in query) {
      filters[key] = query[key];
      delete query[key];
    }
  }
  if ('is_global' in query) query.is_global = sqliteBool(query.is_global);
  context.params.sessionListFilters = filters;
  return context;
}

function applySessionListFilters(context) {
  const filters = context.params.sessionListFilters || {};
  const knex = context.params.knex ?? context.service.createQuery(context.params);
  if (queryFlagDisabled(filters.include_archived)) {
    knex.whereNull('archived_at');
  }
  if (queryFlagDisabled(filters.include_loop_runs)) {
    knex.whereNull('loop_id');
  }
  if (queryFlagEnabled(filters.all_sessions)) {
    const userId = context.params.user?.id;
    knex.where(function hideOptedOutRepos() {
      this.where('is_global', 1).orWhereNotExists(function () {
        const sub = this.select(1)
          .from('user_repos')
          .whereRaw('user_repos.repo_id = sessions.repo_id')
          .andWhere('user_repos.show_in_all_sessions', 0);
        if (userId != null) sub.andWhere('user_repos.user_id', userId);
      });
    });
  }
  context.params.knex = knex;
  return context;
}

function applyGroupSort(context) {
  if (context.params.knex) {
    delete context.params.query?.$sort;
    context.params.knex = context.params.knex
      .orderByRaw('CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END ASC')
      .orderBy('last_activity_at', 'desc');
  }
  return context;
}

export const sessionsHooks = {
  before: {
    all: [requireUser, sanitizeSessionFindQuery, scopeByUser],
    find: [applySessionListFilters, applyGroupSort],
    create: [
      ensureShortId,
      seedLastActivityOnCreate,
      validateSessionCreate,
      serializePlugins,
      extractInitialFiles,
      normalizeModelFields,
      seedReviewModelFromSession,
    ],
    patch: [requireOwnSession, normalizeModelFields],
    getSessionByShortId: [],
    stop: [resolveSessionFromData],
    commands: [resolveSessionFromData],
    baguetteYaml: [resolveSessionFromData],
    diff: [resolveSessionFromData],
    changedFiles: [resolveSessionFromData],
    sessionGitStatus: [resolveSessionFromData],
    sessionUsage: [resolveSessionFromData],
    branchCommits: [resolveSessionFromData],
    shas: [resolveSessionFromData],
    showDiff: [resolveSessionFromData],
    merge: [resolveSessionFromData],
    setPrDraft: [resolveSessionFromData],
    push: [resolveSessionFromData],
    restore: [resolveSessionFromData],
    getPrDetails: [resolveSessionFromData],
    previewStatus: [resolveSessionFromData],
    startPreviewService: [resolveSessionFromData],
  },
  after: {
    find: [addHasWebserver],
    get: [refreshPrStatusAfterGet, addHasWebserver],
    getSessionByShortId: [refreshPrStatusAfterGet, addHasWebserver],
    create: [scheduleSessionProvisioning, addHasWebserver],
    patch: [syncSessionSettingsAfterPatch, addHasWebserver],
  },
};

function refreshPrStatusInBackground(app, session) {
  if (!session?.pr_number || session.pr_status === 'merged') return;
  app
    .service('users')
    .get(session.user_id, {})
    .then((user) => {
      const token = getGithubToken(user);
      if (!token) return;
      return getPRStatus(token, session.repo_full_name, session.pr_number).then((pr_status) => {
        if (pr_status !== session.pr_status) {
          app
            .service('sessions')
            .patch(
              session.id,
              { pr_status },
              { provider: undefined, user: { id: session.user_id } }
            );
        }
      });
    })
    .catch(() => {});
}

async function refreshPrStatusAfterGet(context) {
  refreshPrStatusInBackground(context.app, context.result);
  return context;
}

async function persistSystemPrompt(context) {
  const session = context.result;
  if (!session) return context;
  if (!session.repo_full_name && !isGlobalSession(session)) return context;

  const agentPrompt = await getEffectiveAgentPrompt(context.app, session.user_id, session.repo_id);
  const promptAppend = await buildSystemPromptAppend(session, { agentPrompt });

  if (!promptAppend) return context;

  await context.app.service('messages').create(
    {
      session_id: session.id,
      type: 'system',
      subtype: 'prompt',
      message_json: JSON.stringify({
        type: 'system',
        subtype: 'prompt',
        content: promptAppend,
      }),
    },
    { provider: undefined, user: context.params.user }
  );
  return context;
}

async function createFirstMessage(context) {
  if (context.params.skipFirstMessage) return context;
  const session = context.result;
  const initialPrompt = session.initial_prompt;
  if (!initialPrompt) return context;
  const initialFiles = context.params.initialFiles;
  const content = initialFiles?.length
    ? [{ type: 'text', text: initialPrompt }, ...initialFiles]
    : initialPrompt;
  const initialSdkMessage = {
    type: 'user',
    message: { role: 'user', content },
  };
  await context.app.service('messages').create(
    {
      session_id: session.id,
      type: 'user',
      message_json: JSON.stringify(initialSdkMessage),
    },
    { user: context.params.user }
  );
  return context;
}
