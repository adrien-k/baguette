import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { NotFound, BadRequest } from '@feathersjs/errors';
import { KnexService } from '@feathersjs/knex';
const execFileAsync = promisify(execFile);
import { loadBaguetteConfig, getAvailableCommands, getScriptCommand } from '../baguette-config.js';
import {
  removeWorktree,
  gitDiff,
  gitHasUncommitted,
  gitCommitsToPush,
  gitLocalAndRemoteSha,
  gitFetch,
  gitPush,
  mergePR,
  markPRReady,
  getPRStatus,
  upsertPR,
  createWorktree,
  configureWorktreeGitIdentity,
  getOpenPRByNumber,
  getOpenPR,
  splitPrBody,
  buildPrBody,
  buildSessionFooter,
} from '../github.js';
import logger from '../../logger.js';
import { requireUser, scopeByUser } from './hooks.js';
import { DEFAULT_PAGINATE, DATA_DIR, resolveDataDirRelativePath } from '../../config.js';
import { getPreviewHost } from '../preview.js';
import {
  getPreviewServiceDefinitions,
  resolvePreviewServiceConfig,
  sessionHasPreviewConfig,
} from '../preview-services.js';
import { isPortListening } from '../port-utils.js';
import path from 'path';
import { buildTaskEnv, getClaudeEnvForSession, interpolateTaskCommand } from '../session-env.js';
import { getEffectiveGithubToken } from '../agent-settings.js';
import { buildSystemPromptAppend } from '../session-prompt.js';
import { getCodeserverUrl } from '../codeserver-handler.js';
import { PREVIEW_WEBSERVICE_TTL_MS } from '../task.js';

/**
 * Sessions service (table: sessions). All methods restricted to params.user's sessions.
 */
export class SessionsService extends KnexService {
  setup(app) {
    this.app = app;

    // On startup, any session that was running or waiting for approval when the
    // server last stopped is now orphaned — reset them to stopped and post a
    // status message to each session's chat so users can see what happened.
    app
      .get('db')('sessions')
      .whereIn('status', ['running', 'approval'])
      .whereNull('archived_at')
      .select('id', 'user_id')
      .then(async (staleSessions) => {
        if (staleSessions.length === 0) return;
        const statusMessage = JSON.stringify({
          type: 'system',
          subtype: 'status',
          status: 'Server restarted — session was stopped',
        });
        for (const session of staleSessions) {
          const userParams = { user: { id: session.user_id } };
          await app.service('messages').create(
            {
              session_id: session.id,
              type: 'system',
              subtype: 'status',
              message_json: statusMessage,
            },
            userParams
          );
          await app.service('sessions').patch(session.id, { status: 'stopped' }, userParams);
        }
        logger.info(`Reset ${staleSessions.length} stale session(s) to stopped on startup`);
      })
      .catch((err) => {
        logger.error(err, 'Failed to reset stale sessions on startup');
      });
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
    const sessions = await db('sessions').where({ repo_id: repoId }).whereNull('archived_at');
    for (const session of sessions) {
      await this.remove(session.id, { user: params?.user });
    }
  }

  async remove(id, params) {
    const userId = params?.user?.id;
    const session = await this.options.Model('sessions').where({ id, user_id: userId }).first();
    if (!session) throw new NotFound('Session not found');
    if (session.archived_at) throw new BadRequest('Session already archived');

    await this._stopAgentSession(session);
    await this._runCleanupAndFinalize(session);
    return session;
  }

  async _runCleanupAndFinalize(session) {
    if (session.worktree_path) {
      const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
      const cleanupCommand = getScriptCommand(baguetteConfig?.session?.cleanup);
      if (cleanupCommand) {
        try {
          await this.app.service('tasks').create(
            {
              session_id: session.id,
              command: cleanupCommand,
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
    await removeWorktree(session, repo);
    this.app.service('tasks').deleteSessionTasks(sessionId);
    const archivedAt = new Date().toISOString();
    await db('sessions').where({ id: sessionId }).update({ archived_at: archivedAt });
    const updated = await db('sessions').where({ id: sessionId }).first();
    this.emit('patched', updated);
  }

  _stopAgentSession(session) {
    const service = session.agent_sdk === 'cursor' ? 'cursor-agent' : 'claude-agent';
    return this.app.service(service).stopSession(session.id);
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
    if (!session?.worktree_path) return { commands: [] };
    const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
    return { commands: getAvailableCommands(baguetteConfig) };
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
        command: webserverConfig.command,
        label,
        ports: Array.isArray(webserverConfig.ports) ? webserverConfig.ports : [],
        ...(webserverConfig.taskKey ? { task_key: webserverConfig.taskKey } : {}),
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
    if (!session?.worktree_path) return { diff: '' };
    const cwd = resolveDataDirRelativePath(session.worktree_path);
    try {
      const user = await this.app.service('users').get(session.user_id, {});
      const token = getEffectiveGithubToken(user);
      const currentBranch = session.remote_branch || session.created_branch;
      await Promise.all([
        session.base_branch ? gitFetch(cwd, token, session.base_branch).catch(() => {}) : null,
        currentBranch && currentBranch !== session.base_branch
          ? gitFetch(cwd, token, currentBranch).catch(() => {})
          : null,
      ]);
      const [diff, hasUncommitted, commitsToPush, { localSha, remoteSha }] = await Promise.all([
        gitDiff(cwd, session.base_branch),
        gitHasUncommitted(cwd),
        gitCommitsToPush(cwd),
        gitLocalAndRemoteSha(cwd),
      ]);
      return { diff, hasUncommitted, commitsToPush, localSha, remoteSha };
    } catch (err) {
      return { diff: '', hasUncommitted: false, error: err.message };
    }
  }

  async shas(data, params) {
    const session = params.resolvedSession;
    if (!session?.worktree_path) return { localSha: null, remoteSha: null };
    const cwd = resolveDataDirRelativePath(session.worktree_path);
    try {
      const user = await this.app.service('users').get(session.user_id, {});
      const token = getEffectiveGithubToken(user);
      const branch = data.branch || session.remote_branch || session.created_branch;
      if (branch) await gitFetch(cwd, token, branch).catch(() => {});
      return await gitLocalAndRemoteSha(cwd, branch || null);
    } catch (err) {
      return { localSha: null, remoteSha: null, error: err.message };
    }
  }

  async showDiff(data, params) {
    const session = params.resolvedSession;
    if (!session?.worktree_path) return { path: data.path, diff: '' };
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
    const token = getEffectiveGithubToken(user);
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
    return { ok: true };
  }

  async push(data, params) {
    const session = params.resolvedSession;
    if (!session?.worktree_path) throw new BadRequest('Session has no worktree');
    const cwd = resolveDataDirRelativePath(session.worktree_path);
    const user = await this.app.service('users').get(session.user_id, {});
    const token = getEffectiveGithubToken(user);
    if (!token) throw new BadRequest('No GitHub token configured');
    const forceMode = data?.forceMode ?? (data?.force ? 'lease' : null);
    const branch = data?.branch || null;
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
          { remote_branch: pushedBranch, created_branch: pushedBranch },
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
      const head = pushedBranch || session.remote_branch || session.created_branch;
      let userPrefix = '';
      let existingPrBody = '';
      if (session.pr_number) {
        try {
          const existingPr = await getOpenPRByNumber(
            token,
            session.repo_full_name,
            session.pr_number
          );
          userPrefix = splitPrBody(existingPr?.body ?? '').userPrefix;
          existingPrBody = existingPr?.body ?? '';
        } catch {
          // non-fatal — proceed without user prefix
        }
      }
      const pr = await upsertPR(token, {
        repoFullName: session.repo_full_name,
        prNumber: session.pr_number,
        title: session.label || session.repo_full_name,
        body: buildPrBody(
          userPrefix,
          session.pr_description ?? '',
          buildSessionFooter(session, existingPrBody)
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
    const token = getEffectiveGithubToken(user);
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

    if (!worktreeExists) {
      const repo = session.repo_id
        ? await db('repos').where({ id: session.repo_id }).first()
        : null;
      if (!repo) throw new BadRequest('Session has no associated repository');
      const user = await this.app.service('users').get(session.user_id, {});
      const token = getEffectiveGithubToken(user);
      if (!token) throw new BadRequest('No GitHub token configured');

      const branch = session.remote_branch || session.created_branch;
      if (!branch) throw new BadRequest('Session has no branch to restore to');

      const { worktreePath: absoluteWorktreePath } = await createWorktree(
        repo,
        branch,
        session.short_id,
        token,
        { detach: false, baseBranch: session.base_branch }
      );
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

    let status;
    let costUpdate = null;
    if (message.type === 'user') {
      status = 'running';
    } else if (message.type === 'result') {
      const subtype = message.subtype;
      status = 'failed';
      try {
        const parsed = JSON.parse(message.message_json || '{}');
        if (subtype === 'success' && !parsed.is_error) status = 'completed';
        if (parsed.total_cost_usd != null) costUpdate = parsed.total_cost_usd;
      } catch {
        /* invalid agent result JSON */
      }
    }

    if (status === undefined && costUpdate === null) return;

    const db = this.app.get('db');
    const session = await db('sessions').where({ id: sessionId }).first();
    if (!session) return;

    const patch = {};
    if (status !== undefined && session.status !== status) patch.status = status;
    if (costUpdate !== null && costUpdate > 0) {
      const prevCost = parseFloat(session.total_cost_usd ?? 0);
      await db('usage').insert({
        session_id: sessionId,
        user_id: session.user_id,
        repo_full_name: session.repo_full_name,
        cost_usd: costUpdate,
        agent_sdk: session.agent_sdk || 'claude',
      });
      patch.total_cost_usd = prevCost + costUpdate;
    }
    if (Object.keys(patch).length > 0) {
      await this.app.service('sessions').patch(sessionId, patch, {
        provider: undefined,
        user: { id: session.user_id },
      });
    }
  }

  async onTurnComplete(sessionId) {
    const db = this.app.get('db');
    const queued = await db('queued_messages')
      .where({ session_id: sessionId })
      .orderBy('created_at', 'asc')
      .first();
    if (!queued) return;
    await this.app.service('queued-messages').remove(queued.id, {
      user: { id: queued.user_id },
    });
    await this.app
      .service('messages')
      .create(
        { session_id: sessionId, type: 'user', message_json: queued.message_json },
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

async function prepareSessionEnvironment(context) {
  const continueExistingBranch = !(context.data.create_new_branch ?? true);

  const { repo_full_name: repoFullName, base_branch: baseBranch } = context.data;
  if (!repoFullName) return context; // headless/system session — no worktree needed

  const db = context.app.get('db');
  const token = getEffectiveGithubToken(context.params.user);
  const shortId = context.data.short_id;
  const repo = await db('repos').where({ full_name: repoFullName }).first();

  if (continueExistingBranch) {
    const workingBranch = baseBranch;
    const branchInUse = await db('sessions')
      .where({ repo_full_name: repoFullName })
      .whereNull('archived_at')
      .where((q) =>
        q.where('created_branch', workingBranch).orWhere('remote_branch', workingBranch)
      )
      .first();
    if (branchInUse) {
      throw new BadRequest(
        `Another active session is already using branch "${workingBranch}". Stop or archive it before continuing on this branch.`
      );
    }

    const defaultForDiff = repo.default_branch || 'main';
    let openPr = null;
    try {
      openPr = await getOpenPR(token, repoFullName, workingBranch);
    } catch (err) {
      logger.error(err, 'getOpenPR during continue-existing-branch session (non-fatal)');
    }
    const baseBranchForWorktree = openPr?.base_ref ?? defaultForDiff;

    const { worktreePath: absoluteWorktreePath } = await createWorktree(
      repo,
      workingBranch,
      shortId,
      token,
      { detach: false, baseBranch: baseBranchForWorktree }
    );
    await configureWorktreeGitIdentity(absoluteWorktreePath, context.params.user);
    Object.assign(context.data, {
      worktree_path: path.relative(DATA_DIR, absoluteWorktreePath),
      repo_id: repo.id,
      created_branch: workingBranch,
      remote_branch: workingBranch,
    });

    if (openPr) {
      Object.assign(context.data, {
        base_branch: openPr.base_ref,
        pr_url: openPr.html_url,
        pr_number: openPr.number,
        pr_status: openPr.draft ? 'draft' : 'open',
        label: openPr.title,
        pr_description: openPr.body ?? null,
      });
    } else {
      context.data.base_branch = defaultForDiff;
      context.data.label = `Continuing: ${workingBranch}`;
    }
  } else {
    const { worktreePath: absoluteWorktreePath } = await createWorktree(
      repo,
      baseBranch,
      shortId,
      token
    );
    await configureWorktreeGitIdentity(absoluteWorktreePath, context.params.user);
    Object.assign(context.data, {
      worktree_path: path.relative(DATA_DIR, absoluteWorktreePath),
      repo_id: repo.id,
    });
    const branchPrefix = context.params.user?.branch_prefix ?? '';
    const fallbackBranch = `${branchPrefix}task-${shortId}`;
    const requestedBranchName = context.data.branch_name;
    let branchName = requestedBranchName
      ? requestedBranchName
          .toLowerCase()
          .replace(/[^a-z0-9/_.-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '') || fallbackBranch
      : fallbackBranch;
    try {
      const agentService = context.data.agent_sdk === 'cursor' ? 'cursor-agent' : 'claude-agent';
      const result = await context.app
        .service(agentService)
        .generateSessionMetadata(
          context.data.initial_prompt || '',
          shortId,
          context.params.user,
          repo
        );
      if (result.label) context.data.label = result.label;
      if (!requestedBranchName)
        branchName = result.branchName ? `${branchPrefix}${result.branchName}` : fallbackBranch;
    } catch (err) {
      logger.error(err, 'Metadata generation error (non-fatal)');
    }
    try {
      await execFileAsync('git', ['checkout', '-b', branchName], {
        cwd: absoluteWorktreePath,
        stdio: 'pipe',
      });
    } catch {
      branchName = fallbackBranch;
      await execFileAsync('git', ['checkout', '-b', branchName], {
        cwd: absoluteWorktreePath,
        stdio: 'pipe',
      });
    }
    context.data.created_branch = branchName;
    context.data.remote_branch = branchName;
  }
  // Remove transient field that is not a DB column
  delete context.data.branch_name;
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
    codeserver_url: absoluteWorktreePath ? getCodeserverUrl(absoluteWorktreePath) : null,
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

export function registerSessionsService(app, path = 'sessions') {
  const options = {
    Model: app.get('db'),
    name: 'sessions',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  app.use(path, new SessionsService(options), {
    events: ['app:error', 'push:request'],
    methods: [
      'find',
      'get',
      'create',
      'patch',
      'remove',
      'stop',
      'commands',
      'diff',
      'shas',
      'showDiff',
      'merge',
      'push',
      'restore',
      'getPrDetails',
      'previewStatus',
      'startPreviewService',
    ],
  });
  app.service(path).hooks(sessionsHooks);
}

function applyGroupSort(context) {
  if (context.params.knex) {
    delete context.params.query?.$sort;
    context.params.knex = context.params.knex.orderByRaw(`
      CASE WHEN archived_at IS NOT NULL THEN 2
           WHEN pr_status = 'merged' THEN 1
           ELSE 0
      END ASC,
      created_at DESC
    `);
  }
  return context;
}

export const sessionsHooks = {
  before: {
    all: [requireUser, scopeByUser],
    find: [applyGroupSort],
    create: [
      ensureShortId,
      prepareSessionEnvironment,
      serializePlugins,
      extractInitialFiles,
      normalizeModelFields,
    ],
    patch: [requireOwnSession, normalizeModelFields],
    stop: [resolveSessionFromData],
    commands: [resolveSessionFromData],
    diff: [resolveSessionFromData],
    shas: [resolveSessionFromData],
    showDiff: [resolveSessionFromData],
    merge: [resolveSessionFromData],
    push: [resolveSessionFromData],
    restore: [resolveSessionFromData],
    getPrDetails: [resolveSessionFromData],
    previewStatus: [resolveSessionFromData],
    startPreviewService: [resolveSessionFromData],
  },
  after: {
    find: [addHasWebserver],
    get: [refreshPrStatusAfterGet, addHasWebserver],
    create: [persistSystemPrompt, createFirstMessage, addHasWebserver],
    patch: [syncSessionSettingsAfterPatch, addHasWebserver],
  },
};

function refreshPrStatusInBackground(app, session) {
  if (!session?.pr_number || session.pr_status === 'merged') return;
  app
    .service('users')
    .get(session.user_id, {})
    .then((user) => {
      const token = getEffectiveGithubToken(user);
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
  if (!session.repo_full_name) return context;

  const promptAppend = await buildSystemPromptAppend(session);

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
