import { NotFound, BadRequest } from '@feathersjs/errors';
import { Task, DEFAULT_TTL_MS } from '../task.js';
import { requireUser, only, disableExternal } from './hooks.js';
import { resolveDataDirRelativePath } from '../../config.js';
import { loadBaguetteConfig, getAvailableTasks, appendTaskArgs } from '../baguette-config.js';
import logger from '../../logger.js';

const MAX_TASKS = 20; // Only keeps 20 task (running + history)

/**
 * Tasks service — in-memory, no DB persistence.
 * Tasks disappear on server restart.
 * Owns the task store and all lifecycle management.
 */
export class TasksService {
  constructor() {
    this._tasks = new Map();
    this._nextId = 1;
  }

  setup(app) {
    this.app = app;
  }

  // ── Store management ──────────────────────────────────────────────────────

  /**
   * Create a new in-memory Task.  Does NOT start its process.
   * Evicts an exited task (or the oldest entry) if at capacity.
   */
  createTask({ sessionId, command, label, taskKey, ports, env, cwd, dependsOn, noTtl, ttlMs }) {
    if (this._tasks.size >= MAX_TASKS) {
      let evicted = false;
      for (const [id, t] of this._tasks) {
        if (t.status === 'exited') {
          this._tasks.delete(id);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        const oldest = this._tasks.keys().next().value;
        this._tasks.delete(oldest);
      }
    }

    const id = this._nextId++;
    const task = new Task({
      id,
      sessionId,
      command,
      label,
      taskKey,
      ports,
      env,
      cwd,
      dependsOn,
      noTtl,
      ttlMs,
    });
    task.onLog((_id, stream, data) =>
      this.emit('log', { id, session_id: sessionId, stream, data })
    );
    task.onExit((_id, _code) => this.emit('patched', task.toPublic()));
    this._tasks.set(id, task);
    return task;
  }

  /** Get the Task instance by id (accepts string or number), or null. */
  getTask(id) {
    return this._tasks.get(Number(id)) ?? null;
  }

  /**
   * Return public task objects filtered by a Set of session IDs and/or status.
   */
  filterTasks({ sessionIds = null, status = null } = {}) {
    let result = Array.from(this._tasks.values());
    if (sessionIds != null) result = result.filter((t) => sessionIds.has(t.session_id));
    if (status != null) result = result.filter((t) => t.status === status);
    return result.map((t) => t.toPublic());
  }

  /**
   * Remove a task from memory (starts graceful kill if still running; does not wait for exit).
   * Returns true if the task existed.
   */
  deleteTask(id) {
    const task = this._tasks.get(Number(id));
    if (!task) return false;
    task.kill().catch((err) => logger.error(err, 'Error while killing task during deleteTask'));
    this._tasks.delete(Number(id));
    return true;
  }

  /** Starts graceful kill for each running task in a session; does not wait for exit. */
  killSessionTasks(sessionId) {
    for (const task of this._tasks.values()) {
      if (task.session_id === sessionId && task.status === 'running') {
        void task.kill().catch(() => {});
      }
    }
  }

  /** Remove all tasks for a session from memory. */
  deleteSessionTasks(sessionId) {
    const ids = [];
    for (const [id, task] of this._tasks) {
      if (task.session_id === sessionId) ids.push(id);
    }
    for (const id of ids) this.deleteTask(id);
  }

  /**
   * SIGTERM each running task (same as user "stop task"), wait for exit, then clear the store.
   * For server shutdown so child processes can exit cleanly before `process.exit`.
   */
  async killAllTasks() {
    const running = Array.from(this._tasks.values()).filter((t) => t.status === 'running');
    await Promise.all(running.map((t) => t.kill()));
    this._tasks.clear();
  }

  /** Most recent task in a session with the given label (any status). */
  findLatestTaskByLabel(sessionId, label) {
    let latest = null;
    for (const task of this._tasks.values()) {
      if (task.session_id === sessionId && task.label === label) {
        if (!latest || task.id > latest.id) latest = task;
      }
    }
    return latest;
  }

  /** Find a running task in this session by its label. */
  _findRunningTask(sessionId, label) {
    for (const task of this._tasks.values()) {
      if (task.session_id === sessionId && task.label === label && task.status === 'running') {
        return task;
      }
    }
    return null;
  }

  /** Reset all in-memory state. For use in tests only. */
  _resetForTest() {
    this._tasks.clear();
    this._nextId = 1;
  }

  // ── Feathers service methods ──────────────────────────────────────────────

  /** Return all tasks the user has access to, optionally filtered by status. */
  async find(params) {
    const { user } = params;
    const query = params.query || {};
    const status = query.status;
    const sessionId = query.session_id != null ? Number(query.session_id) : null;

    let sessionIds;
    if (sessionId) {
      try {
        await this.app.service('sessions').get(sessionId, { user });
        sessionIds = new Set([sessionId]);
      } catch {
        return [];
      }
    } else {
      const rows = await this.app.get('db')('sessions').where({ user_id: user.id }).select('id');
      sessionIds = new Set(rows.map((r) => r.id));
    }

    const result = this.filterTasks({ sessionIds, status });
    result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return result;
  }

  /** Get a single task by id, verifying the user owns its session. */
  async get(id, params) {
    const task = this.getTask(id);
    if (!task) throw new NotFound(`Task ${id} not found`);
    await this.app.service('sessions').get(task.session_id, { user: params.user });
    return task.toPublic();
  }

  /**
   * Create a task in memory, optionally starting it immediately (default: true).
   *
   * Callers name *what* to run, not *how*: pass `task_key` and the command, ports and
   * dependencies are resolved from `.baguette.yaml` here. `command` stays available as the
   * ad-hoc escape hatch (the "Run a command…" input) and as an override for internal callers
   * that have no task in the config (e.g. an inline `webserver.command`).
   */
  async create(data, params) {
    const {
      session_id,
      command: rawCommand,
      args,
      label,
      ports,
      task_key,
      extra_env,
      onLog,
      onExit,
      skipInit,
      _depChain,
      autoStart = true,
      no_ttl: noTtl = false,
      ttl_ms: ttlMs,
    } = data;
    const effectiveTtlMs = noTtl ? null : (ttlMs ?? DEFAULT_TTL_MS);
    const session = await this.app.service('sessions').get(session_id, { user: params.user });
    if (session.archived_at) throw new BadRequest('Cannot start task on an archived session');

    // Load config once for command resolution, init and deps lookups
    const baguetteConfig = session.worktree_path
      ? await loadBaguetteConfig(session.worktree_path)
      : null;
    if (baguetteConfig?.error) throw new BadRequest(baguetteConfig.error);
    const taskDefs = baguetteConfig ? getAvailableTasks(baguetteConfig) : {};

    const taskDef = task_key ? taskDefs[task_key] : null;
    if (task_key && !taskDef && !rawCommand) {
      throw new BadRequest(`Task "${task_key}" is not defined in .baguette.yaml`);
    }
    const resolvedCommand = rawCommand ?? taskDef?.run;
    if (!resolvedCommand) throw new BadRequest('A task_key or a command is required');

    const effectiveLabel = label ?? task_key ?? null;
    const effectivePorts = ports ?? taskDef?.ports ?? [];

    const baseEnv = await this.app.service('sessions').getTaskEnv(session.id, task_key ?? null);
    const env = extra_env ? { ...baseEnv, ...extra_env } : baseEnv;
    const interpolatedCommand = await this.app
      .service('sessions')
      .getInterpolatedCommand(session.id, appendTaskArgs(resolvedCommand, args));
    const cwd = session.absolute_worktree_path ?? resolveDataDirRelativePath(session.worktree_path);

    const dependsOn = [];

    // Add init as a dependency if the session has not been initialized yet
    if (!skipInit && !session.initialized && session.worktree_path) {
      // Mark initialized eagerly to prevent double-init on concurrent task starts.
      await this.app.get('db')('sessions').where({ id: session_id }).update({ initialized: true });
      if (taskDefs['baguette:init']) {
        const initPub = await this.create(
          { session_id, task_key: 'baguette:init', skipInit: true, autoStart: false },
          params
        );
        dependsOn.push(this.getTask(initPub.id));
      }
    }

    // Add .baguette.yaml declared dependencies (transitive, cycle-detected via _depChain)
    if (task_key && baguetteConfig) {
      const depChain = new Set(_depChain ?? []);
      depChain.add(task_key);
      for (const depKey of taskDef?.depends_on ?? []) {
        if (depChain.has(depKey))
          throw new BadRequest(
            `Circular dependency detected: ${depKey} is already in the dependency chain`
          );
        if (!taskDefs[depKey])
          throw new BadRequest(`Dependency task "${depKey}" not found in session.tasks`);
        let depTask = this._findRunningTask(session_id, depKey);
        if (!depTask) {
          const depPub = await this.create(
            {
              session_id,
              task_key: depKey,
              skipInit: true,
              _depChain: [...depChain],
              autoStart: false,
            },
            params
          );
          depTask = this.getTask(depPub.id);
        }
        if (depTask) dependsOn.push(depTask);
      }
    }

    const task = this.createTask({
      sessionId: session_id,
      command: interpolatedCommand,
      label: effectiveLabel,
      taskKey: task_key ?? null,
      ports: effectivePorts,
      env,
      cwd,
      dependsOn,
      noTtl,
      ttlMs: effectiveTtlMs,
    });
    if (onLog) task.onLog(onLog);
    if (onExit) task.onExit(onExit);
    this.emit('created', task.toPublic());

    if (dependsOn.length > 0) {
      const initDep = dependsOn.find((t) => t.label === 'baguette:init');
      if (initDep)
        task.addLog('stdout', `\x1b[2m[baguette] Init running in task #${initDep.id}...\x1b[0m\n`);
    }

    if (autoStart) {
      task.start();
    }

    return task.toPublic();
  }

  /**
   * Update a task in memory and emit a patched event.
   * External access is forbidden by the disableExternal hook.
   */
  async patch(id, data, _params) {
    const task = this.getTask(id);
    if (!task) throw new NotFound(`Task ${id} not found`);
    Object.assign(task, data);
    const pub = task.toPublic();
    this.emit('patched', pub);
    return pub;
  }

  /** Remove a task from memory (kills its process if still running). */
  async remove(id, params) {
    const pub = await this.get(id, params); // verifies ownership
    this.deleteTask(id);
    this.emit('removed', pub);
    return pub;
  }

  async kill(data, params) {
    const task = await this.get(data, params);
    const success = (await this.getTask(task.id)?.kill()) ?? false;
    return { success };
  }

  async logs(data, params) {
    const task = await this.get(data, params);
    const logs = this.getTask(task.id)?.getLogs() ?? '';
    return { id: task.id, logs };
  }
}

export function registerTasksService(app, path = 'tasks') {
  app.use(path, new TasksService(), {
    methods: ['find', 'get', 'create', 'patch', 'remove', 'kill', 'logs'],
    events: ['log'],
  });
  app.service(path).hooks(tasksHooks);
}

export const tasksHooks = {
  before: {
    all: [requireUser],
    // `task_key` names a .baguette.yaml task (command/ports/label resolved server-side);
    // `command` is the ad-hoc "Run a command…" escape hatch.
    create: [only(['session_id', 'task_key', 'command', 'args'])],
    patch: [disableExternal],
  },
};
