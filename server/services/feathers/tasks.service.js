import { NotFound, BadRequest } from '@feathersjs/errors';
import { Task } from '../task.js';
import { requireUser, only, disableExternal } from './hooks.js';
import { resolveDataDirRelativePath } from '../../config.js';
import { loadBaguetteConfig, getScriptCommand, getAvailableTasks, interpolateTaskPorts } from '../baguette-config.js';
import { waitForPorts } from '../port-utils.js';
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
  createTask({ sessionId, command, label, ports }) {
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
    const task = new Task({ id, sessionId, command, label, ports, taskService: this });
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

  /** Find a running task in this session by its label. */
  _findRunningTask(sessionId, label) {
    for (const task of this._tasks.values()) {
      if (task.session_id === sessionId && task.label === label && task.status === 'running') {
        return task;
      }
    }
    return null;
  }

  /**
   * Resolve `depends_on` for a task: start missing dependencies and wait for their ports.
   * Returns a port map: `{ [taskKey]: { PORT_NAME: portNumber } }`.
   */
  async _resolveDependencies(sessionId, taskKey, baguetteConfig, params, visited = new Set()) {
    if (visited.has(taskKey)) throw new BadRequest(`Circular dependency detected: ${taskKey}`);
    visited.add(taskKey);

    const tasks = getAvailableTasks(baguetteConfig);
    const taskDef = tasks[taskKey];
    if (!taskDef?.depends_on?.length) return {};

    const depPortMap = {};
    for (const depKey of taskDef.depends_on) {
      const depDef = tasks[depKey];
      if (!depDef) throw new BadRequest(`Dependency task "${depKey}" not found in session.tasks`);

      let runningDep = this._findRunningTask(sessionId, depKey);
      if (!runningDep) {
        // Recursively resolve the dependency's own dependencies first
        const nestedPorts = await this._resolveDependencies(sessionId, depKey, baguetteConfig, params, new Set(visited));
        const depCommand = interpolateTaskPorts(depDef.run, nestedPorts);

        const depPublic = await this.create(
          {
            session_id: sessionId,
            command: depCommand,
            label: depKey,
            ports: depDef.ports || [],
            skipInit: true,
            _skipDependencyResolution: true,
          },
          params
        );
        runningDep = this.getTask(depPublic.id);
      }

      // Wait for dependency ports to be listening
      if (runningDep && Object.keys(runningDep.ports).length > 0) {
        const listening = await waitForPorts(Object.values(runningDep.ports));
        if (!listening) throw new BadRequest(`Dependency "${depKey}" ports did not start listening within timeout`);
      }

      depPortMap[depKey] = runningDep?.ports ?? {};
    }
    return depPortMap;
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

  /** Create a task in memory and spawn its process. */
  async create(data, params) {
    const { session_id, command, label, ports, task_key, onLog, onExit, skipInit, _skipDependencyResolution } = data;
    const session = await this.app.service('sessions').get(session_id, { user: params.user });
    if (session.archived_at) throw new BadRequest('Cannot start task on an archived session');

    // Lazy init: prepend the session init command so its logs stream with this task.
    let effectiveCommand = command;
    if (!skipInit && !session.initialized && session.worktree_path) {
      const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
      const initCommand = getScriptCommand(baguetteConfig?.session?.init);
      // Mark initialized first to prevent double-init on concurrent task starts.
      await this.app.get('db')('sessions').where({ id: session_id }).update({ initialized: true });
      if (initCommand) {
        effectiveCommand = `${initCommand}\n${command}`;
      }
    }

    // Dependency resolution: start dependency tasks and inject their ports
    if (task_key && !_skipDependencyResolution && session.worktree_path) {
      const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
      if (baguetteConfig) {
        const depPortMap = await this._resolveDependencies(session_id, task_key, baguetteConfig, params);
        if (Object.keys(depPortMap).length > 0) {
          effectiveCommand = interpolateTaskPorts(effectiveCommand, depPortMap);
        }
      }
    }

    const task = this.createTask({
      sessionId: session_id,
      command: effectiveCommand,
      label,
      ports,
    });
    const env = await this.app.service('sessions').getTaskEnv(session.id);
    const cwd = session.absolute_worktree_path ?? resolveDataDirRelativePath(session.worktree_path);
    await task.start({ cwd, env, onLog, onExit });
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
    create: [only(['session_id', 'command', 'label', 'ports', 'task_key'])],
    patch: [disableExternal],
  },
};
