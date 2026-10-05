import { NotFound, BadRequest } from '@feathersjs/errors';
import { Task, DEFAULT_TTL_MS, DEPENDS_ON_TTL_MS, compileNotifyPattern } from '../task.js';
import { requireUser, only, disableExternal } from './hooks.js';
import { resolveDataDirRelativePath } from '../../config.js';
import {
  loadBaguetteConfig,
  getAvailableTasks,
  appendTaskArgs,
  BaguetteConfigError,
  TaskEnvInterpolationError,
  assertTaskEnvReferencesValid,
} from '../baguette-config.js';
import logger from '../../logger.js';
import { isTaskActive, isTaskStoppable, isTaskTerminal } from '../../../shared/task-status.js';

const MAX_TASKS = 20; // Only keeps 20 task (running + history)

/** Default and cap for `awaitTask` waits (matches the wake-up loop's per-event budget). */
export const TASK_AWAIT_TIMEOUT_MS = 10 * 60_000;

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
   *
   * @param {number} [ttl] - Idle shutdown window in ms; omit for manually started tasks.
   */
  createTask({
    sessionId,
    shortId,
    command,
    label,
    taskKey,
    ports,
    env,
    cwd,
    notifyPattern,
    origin = 'user',
    dependsOn,
    isRoot = false,
    ttl,
    dockerContainer,
    dockerPortMappings,
    dockerEnvKeys,
    taskEnvRaw,
    configTaskKeys,
    dependsOnKeys,
    extraEnv,
    interpolateOpts,
  }) {
    if (this._tasks.size >= MAX_TASKS) {
      let evicted = false;
      for (const [id, t] of this._tasks) {
        if (isTaskTerminal(t.status)) {
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
      shortId,
      command,
      label: taskKey ?? label ?? null,
      taskKey,
      ports,
      env,
      cwd,
      notifyPattern,
      origin,
      dependsOn,
      isRoot,
      ttl,
      dockerContainer,
      dockerPortMappings,
      dockerEnvKeys,
      taskEnvRaw,
      configTaskKeys,
      dependsOnKeys,
      extraEnv,
      interpolateOpts,
    });
    task.onLog((_id, stream, data) => {
      if (typeof this.emit === 'function') {
        this.emit('log', { id, session_id: sessionId, stream, data });
      }
    });
    const emitPatched = () => {
      if (typeof this.emit === 'function') this.emit('patched', task.toPublic());
    };
    task.onStatusChange(() => emitPatched());
    task.onExit((_id, _code) => emitPatched());
    this._tasks.set(id, task);
    // Guarded: bare service instances (unit tests) have no EventEmitter methods.
    if (typeof this.emit === 'function') this.emit('created', task.toPublic());
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
      if (task.session_id === sessionId && isTaskStoppable(task.status)) {
        void task.kill().catch(() => {});
      }
    }
  }

  /**
   * Kill every running task in a session that the *agent* started (RunCommand
   * background tasks — monitored or not) plus any monitored task, since monitored
   * tasks carry wake-up obligations that die with the turn. Tasks the user started
   * (command panel / API), preview & devproxy tasks, and tasks belonging to
   * user-started trees (deps, init) are left running.
   */
  killSessionAgentTasks(sessionId, reason = 'stopped') {
    const killed = [];
    for (const task of this._tasks.values()) {
      if (task.session_id !== sessionId || !isTaskStoppable(task.status)) continue;
      if (task.origin !== 'agent' && !task.notify_pattern) continue;
      killed.push(task);
      void task.kill({ reason }).catch(() => {});
    }
    return killed;
  }

  /**
   * Wait for the first notify event (new pattern match or exit) among the given task ids.
   *
   * Resolves { task_id, event: 'pattern' | 'exit' | 'timeout', status, exit_code,
   * matched_line, aborted }. Pattern events are consumed once: each call returns only
   * matches that arrived since the last consumption, so awaiting the same running task
   * twice waits for a *new* match the second time. Terminal tasks resolve immediately;
   * 'timeout' (task_id null) when nothing fires within timeoutMs.
   */
  async waitForTaskEvent(taskIds, { timeoutMs = 10 * 60_000, signal = null } = {}) {
    const ids = (taskIds ?? []).map((id) => Number(id)).filter((id) => this._tasks.has(id));
    const timeoutResult = {
      task_id: null,
      event: 'timeout',
      status: null,
      exit_code: null,
      matched_line: null,
      aborted: false,
    };
    if (!ids.length) return { ...timeoutResult, aborted: Boolean(signal?.aborted) };

    const tasks = ids.map((id) => this._tasks.get(id));

    const finish = (partial) => ({ aborted: false, ...partial });

    // Tasks that already have something to report resolve immediately.
    for (const task of tasks) {
      if (isTaskTerminal(task.status) && !task._exitConsumed) {
        task._exitConsumed = true;
        task._consumedNotifyMatches = task._matchedNotifyLines.length;
        return finish({
          task_id: task.id,
          event: 'exit',
          status: task.status,
          exit_code: task.exit_code,
          matched_line: task._matchedNotifyLines.at(-1) ?? null,
        });
      }
      if (task._matchedNotifyLines.length > (task._consumedNotifyMatches ?? 0)) {
        task._consumedNotifyMatches = task._matchedNotifyLines.length;
        return finish({
          task_id: task.id,
          event: 'pattern',
          status: task.status,
          exit_code: null,
          matched_line: task._matchedNotifyLines.at(-1),
        });
      }
    }

    let timeoutHandle = null;
    let abortHandler = null;
    let settled = false;
    const unsubs = [];

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      for (const unsub of unsubs) unsub();
    };

    const listenPromise = new Promise((resolve) => {
      const onEvent = (event) => {
        const task = this._tasks.get(event.task_id);
        if (task && event.event === 'exit') {
          task._exitConsumed = true;
        }
        if (event.event === 'pattern' && task) {
          task._consumedNotifyMatches = Math.max(
            task._consumedNotifyMatches ?? 0,
            task._matchedNotifyLines.length
          );
        }
        resolve(event);
      };
      for (const task of tasks) {
        unsubs.push(task.onNotify(onEvent));
      }
    });

    const timeoutPromise = new Promise((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ ...timeoutResult }), Math.max(0, timeoutMs));
    });

    const abortPromise = signal
      ? new Promise((resolve) => {
          abortHandler = () => resolve({ ...timeoutResult, aborted: true });
          if (signal.aborted) {
            resolve({ ...timeoutResult, aborted: true });
          } else {
            signal.addEventListener('abort', abortHandler, { once: true });
          }
        })
      : null;

    try {
      const event = await Promise.race(
        abortPromise
          ? [listenPromise, timeoutPromise, abortPromise]
          : [listenPromise, timeoutPromise]
      );
      return finish(event);
    } finally {
      cleanup();
    }
  }

  /**
   * Observe notify events (pattern match / exit) of a session's monitored tasks as they
   * fire, without consuming them — `waitForTaskEvent` consumers (wake-up drain, awaitTask)
   * are unaffected. Also attaches to monitored tasks created while watching. The callback
   * receives (event, task) and must not throw. Returns an unsubscribe function.
   */
  watchSessionTaskNotifies(sessionId, cb) {
    const unsubs = [];
    const attached = new Set();
    const attach = (task) => {
      if (!task || task.session_id !== sessionId || !task.notify_pattern) return;
      // create() emits `created` both explicitly and via the Feathers event hook, so
      // guard against double-attaching the same task.
      if (attached.has(task)) return;
      attached.add(task);
      unsubs.push(task.onNotify((event) => cb(event, task)));
    };
    for (const task of this._tasks.values()) attach(task);
    const onCreated = (pub) => attach(this._tasks.get(pub.id));
    // Guarded: bare service instances (unit tests) have no EventEmitter methods, so
    // tasks created later are simply not observed there.
    if (typeof this.on === 'function') this.on('created', onCreated);
    return () => {
      if (typeof this.removeListener === 'function') this.removeListener('created', onCreated);
      for (const unsub of unsubs) unsub();
    };
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
    const running = Array.from(this._tasks.values()).filter((t) => isTaskStoppable(t.status));
    await Promise.all(running.map((t) => t.kill()));
    this._tasks.clear();
  }

  /**
   * Most recent task in a session for a config task key or ad-hoc label (any status).
   * Config-backed tasks match on `task_key`; inline tasks (no task_key) match on `label`.
   */
  findLatestTaskByKey(sessionId, key) {
    let latest = null;
    for (const task of this._tasks.values()) {
      if (task.session_id !== sessionId) continue;
      if (!this._taskMatchesLookupKey(task, key)) continue;
      if (!latest || task.id > latest.id) latest = task;
    }
    return latest;
  }

  /** @deprecated Use findLatestTaskByKey */
  findLatestTaskByLabel(sessionId, label) {
    return this.findLatestTaskByKey(sessionId, label);
  }

  /** Find a running task by config task key, or by label when the task has no task_key. */
  _findRunningTask(sessionId, key) {
    for (const task of this._tasks.values()) {
      if (task.session_id !== sessionId || !isTaskActive(task.status)) continue;
      if (this._taskMatchesLookupKey(task, key)) return task;
    }
    return null;
  }

  _taskMatchesLookupKey(task, key) {
    if (task.task_key) return task.task_key === key;
    return task.label === key;
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
      notify_pattern: notifyPattern,
      origin: requestedOrigin,
      onLog,
      onExit,
      skipInit,
      _depChain,
      autoStart = true,
      ttl_ms: ttlMs,
    } = data;
    // External creates (command panel / API) are user tasks. Internal creates are
    // agent tasks unless the caller says otherwise: preview services pass 'preview'
    // and dependency/init creates inherit their root task's origin.
    const taskOrigin = params?.provider ? 'user' : (requestedOrigin ?? 'agent');
    const hasNotifyPattern = typeof notifyPattern === 'string' && notifyPattern.length > 0;
    if (hasNotifyPattern && !compileNotifyPattern(notifyPattern)) {
      throw new BadRequest(`Invalid notify_pattern regex: ${notifyPattern}`);
    }
    const isDependencyCreate = (_depChain?.length ?? 0) > 0;
    const effectiveTtl =
      isDependencyCreate || ttlMs != null
        ? (ttlMs ?? (isDependencyCreate ? DEPENDS_ON_TTL_MS : DEFAULT_TTL_MS))
        : undefined;
    const session = await this.app.service('sessions').get(session_id, { user: params.user });
    if (session.archived_at) throw new BadRequest('Cannot start task on an archived session');

    // Load config once for command resolution, init and deps lookups
    const baguetteConfig = session.worktree_path
      ? await loadBaguetteConfig(session.worktree_path)
      : null;
    if (baguetteConfig?.error) throw new BadRequest(baguetteConfig.error);
    let taskDefs;
    try {
      taskDefs = baguetteConfig ? getAvailableTasks(baguetteConfig) : {};
    } catch (err) {
      if (err instanceof BaguetteConfigError) throw new BadRequest(err.message);
      throw err;
    }

    const taskDef = task_key ? taskDefs[task_key] : null;
    if (task_key && !taskDef && !rawCommand) {
      throw new BadRequest(`Task "${task_key}" is not defined in .baguette.yaml`);
    }
    const isDockerTask = taskDef?.type === 'docker';
    const dockerContainer =
      isDockerTask && taskDef?.container
        ? await this.app
            .service('sessions')
            .getInterpolatedConfigValue(session.id, taskDef.container)
        : null;
    const resolvedCommand =
      rawCommand ??
      (isDockerTask
        ? `docker:${dockerContainer?.image ?? (dockerContainer?.build ? 'build' : 'container')}`
        : taskDef?.run);
    if (!resolvedCommand) throw new BadRequest('A task_key or a command is required');

    // Config tasks are always identified by task_key; label is only for ad-hoc / internal tasks.
    const effectiveLabel = task_key ?? label ?? null;
    const effectivePorts = ports ?? taskDef?.ports ?? [];

    const configTaskKeys = new Set(Object.keys(taskDefs));
    const taskEnvRaw =
      taskDef?.env && typeof taskDef.env === 'object' && !Array.isArray(taskDef.env)
        ? taskDef.env
        : null;
    let baseEnv;
    let interpolateOpts;
    try {
      if (taskEnvRaw) {
        assertTaskEnvReferencesValid(taskEnvRaw, configTaskKeys, taskDef?.depends_on ?? []);
      }
      baseEnv = await this.app.service('sessions').getTaskEnv(session.id);
      interpolateOpts = await this.app.service('sessions').getInterpolateOpts(session.id);
    } catch (err) {
      if (err instanceof TaskEnvInterpolationError) throw new BadRequest(err.message);
      throw err;
    }
    const env = baseEnv;
    const interpolatedCommand = await this.app
      .service('sessions')
      .getInterpolatedCommand(session.id, appendTaskArgs(resolvedCommand, args));
    const cwd = session.absolute_worktree_path ?? resolveDataDirRelativePath(session.worktree_path);

    const dependsOn = [];

    const attachYamlDependsOn = async () => {
      if (!task_key || !baguetteConfig) return;
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
              origin: taskOrigin,
            },
            // Internal: omit provider so `only()` does not strip `_depChain`.
            { user: params.user }
          );
          depTask = this.getTask(depPub.id);
        }
        if (depTask) dependsOn.push(depTask);
      }
    };

    // Run session.init before yaml depends-on (install-only; DB setup belongs on tasks with depends-on).
    if (
      !skipInit &&
      !session.initialized &&
      session.worktree_path &&
      task_key !== 'baguette:init'
    ) {
      // Mark initialized eagerly to prevent double-init on concurrent task starts.
      await this.app.get('db')('sessions').where({ id: session_id }).update({ initialized: true });
      const initDef = taskDefs['baguette:init'];
      if (initDef) {
        const initCommand = await this.app
          .service('sessions')
          .getInterpolatedCommand(session.id, initDef.run);
        const initEnv = await this.app.service('sessions').getTaskEnv(session.id);
        const initTask = this.createTask({
          sessionId: session_id,
          shortId: session.short_id,
          command: initCommand,
          taskKey: 'baguette:init',
          ports: [],
          env: initEnv,
          cwd,
          origin: taskOrigin,
          dependsOn: [],
          ttl: DEPENDS_ON_TTL_MS,
          interpolateOpts,
        });
        dependsOn.push(initTask);
      }
    }

    await attachYamlDependsOn();

    const sessionEnvKeys =
      baguetteConfig?.session?.env &&
      typeof baguetteConfig.session.env === 'object' &&
      !Array.isArray(baguetteConfig.session.env)
        ? Object.keys(baguetteConfig.session.env)
        : [];
    const dockerEnvKeys = [
      ...new Set([...sessionEnvKeys, ...(taskEnvRaw ? Object.keys(taskEnvRaw) : [])]),
    ];

    const task = this.createTask({
      sessionId: session_id,
      shortId: session.short_id,
      command: interpolatedCommand,
      label: effectiveLabel,
      taskKey: task_key ?? null,
      ports: effectivePorts,
      env,
      cwd,
      notifyPattern: hasNotifyPattern ? notifyPattern : null,
      origin: taskOrigin,
      dependsOn,
      isRoot: !isDependencyCreate,
      ttl: effectiveTtl,
      dockerContainer,
      dockerPortMappings: null,
      dockerEnvKeys: isDockerTask ? dockerEnvKeys : null,
      taskEnvRaw,
      configTaskKeys: [...configTaskKeys],
      dependsOnKeys: taskDef?.depends_on ?? [],
      extraEnv: extra_env ?? null,
      interpolateOpts,
    });
    if (onLog) task.onLog(onLog);
    if (onExit) task.onExit(onExit);
    // `created` fires inside createTask so every task creation path emits exactly once.

    if (dependsOn.length > 0) {
      const initDep = dependsOn.find((t) => t.task_key === 'baguette:init');
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

  /**
   * Block until the task reports its next notify event — a new notify_pattern match
   * or its exit — or until `timeout_ms` (query param) elapses. Default and cap:
   * TASK_AWAIT_TIMEOUT_MS. Same consumed-once semantics as waitForTaskEvent: a
   * wake-up already delivered to a previous wait is not repeated, so repeated calls
   * only surface fresh events. Resolves with the event plus a small `output_tail`
   * so callers rarely need a second logs read.
   */
  async awaitTask(id, params) {
    const pub = await this.get(id, params); // verifies ownership
    const requested = Number(params?.query?.timeout_ms);
    const timeoutMs =
      Number.isFinite(requested) && requested >= 0
        ? Math.min(requested, TASK_AWAIT_TIMEOUT_MS)
        : TASK_AWAIT_TIMEOUT_MS;
    const event = await this.waitForTaskEvent([pub.id], { timeoutMs });
    const task = this.getTask(pub.id);
    return { ...event, output_tail: task ? task.tailLogs() : null };
  }
}

export function registerTasksService(app, path = 'tasks') {
  app.use(path, new TasksService(), {
    methods: ['find', 'get', 'create', 'patch', 'remove', 'kill', 'logs', 'awaitTask'],
    events: ['log'],
  });
  app.service(path).hooks(tasksHooks);
}

export const tasksHooks = {
  before: {
    all: [requireUser],
    // `task_key` names a .baguette.yaml task (command/ports/label resolved server-side);
    // `command` is the ad-hoc "Run a command…" escape hatch. `extra_env` and
    // `notify_pattern` are the monitored-run knobs surfaced via RunCommand.
    create: [only(['session_id', 'task_key', 'command', 'args', 'extra_env', 'notify_pattern'])],
    patch: [disableExternal],
  },
};
