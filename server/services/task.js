import { spawn } from 'child_process';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import net from 'net';
import { interpolateConfigTaskPorts, resolveTaskEnv } from './baguette-config.js';
import { isPortListening } from './port-utils.js';
import {
  normalizeDockerContainer,
  dockerContainerHostname,
  buildDockerImage,
  spawnDockerContainer,
  stopDockerContainer,
  waitForContainerHealth,
} from './docker-session.js';
import { isTaskStoppable, isTaskTerminal } from '../../shared/task-status.js';

/** Default idle TTL (ms) when `ttl` is set without an explicit value (preview auto-start, etc.). */
export const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes
/** Idle TTL for tasks created as another task's `depends_on` (or session init in that chain). */
export const DEPENDS_ON_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** How often a task heartbeats its depends_on tasks. */
export const HEARTBEAT_INTERVAL_MS = 60 * 1000;
/** After SIGTERM, wait this long before escalating to SIGKILL. */
export const KILL_GRACE_MS = 30_000;

/** Cap on remembered matching lines per monitored task. */
const MAX_NOTIFY_MATCHES = 20;

/** Compile a notify pattern (null when absent); invalid patterns yield null. */
export function compileNotifyPattern(notifyPattern) {
  if (!notifyPattern) return null;
  try {
    return new RegExp(notifyPattern);
  } catch {
    return null;
  }
}

function baguetteStatusLine(message) {
  return `\x1b[33m[baguette] ${message}\x1b[0m\n`;
}

/** True while `start()` may still run depends_on or spawn the process (not shutting down). */
function isTaskStartupContinuing(status) {
  return status === 'waiting' || status === 'running';
}

/** True when a parent heartbeat may refresh this task's idle TTL. */
function isTaskHeartbeatEligible(status) {
  return status === 'waiting' || status === 'running';
}

/** Env passed to `docker run -e` — session/task/extra/port keys only, not host process.env. */
export function buildDockerRunEnv(fullEnv, declaredKeys, extraEnv, portEnvVars = []) {
  const keys = new Set(Array.isArray(declaredKeys) ? declaredKeys : []);
  if (extraEnv && typeof extraEnv === 'object') {
    for (const key of Object.keys(extraEnv)) keys.add(key);
  }
  for (const key of portEnvVars) keys.add(key);
  const env = {};
  for (const key of keys) {
    const value = fullEnv[key];
    if (value != null && value !== '') env[key] = value;
  }
  return env;
}

/** Release stdio streams and listeners after the child exits (task row stays for UI/logs). */
function detachChildProcess(child) {
  try {
    child.stdin?.destroy();
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.removeAllListeners();
  } catch {
    // ignore
  }
}

/** Where multi-line task scripts are written before being executed. */
const SCRIPT_DIR = join(tmpdir(), 'baguette-tasks');

/**
 * Write a multi-line command to an executable script file.
 * A script keeps the block's own control flow (loops, `if`, heredocs, comments) intact,
 * unlike collapsing it into a single `sh -c` string.
 * Returns `{ path, argv }`, where argv is what to spawn.
 */
async function writeScriptFile(id, command) {
  await mkdir(SCRIPT_DIR, { recursive: true });
  const path = join(SCRIPT_DIR, `task-${id}-${Date.now()}.sh`);
  // A user-supplied shebang wins: the script is then executed directly so the
  // requested interpreter (bash, zsh, node…) is the one that runs it.
  const hasShebang = command.startsWith('#!');
  const body = hasShebang ? command : `#!/bin/sh\nset -e\n${command}`;
  await writeFile(path, body.endsWith('\n') ? body : `${body}\n`, {
    encoding: 'utf8',
    mode: 0o700,
  });
  return { path, argv: hasShebang ? [path, []] : ['sh', [path]] };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

/**
 * Represents a single ephemeral task (child process).
 */
export class Task {
  #process = null;
  #logBuffer = [];
  #idleTtlTimer = null;
  #heartbeatTimer = null;
  constructor({
    id,
    sessionId,
    shortId = null,
    command,
    label,
    taskKey,
    ports,
    env,
    cwd,
    dependsOn,
    /** Panel / user-started task (not created only as another task's depends_on). */
    isRoot = false,
    /**
     * Who started this task: 'user' (command panel / API create), 'agent'
     * (RunCommand from the agent), or 'preview' (preview/devproxy service).
     * Stop-turn kills agent tasks; user and preview tasks keep running.
     */
    origin = 'user',
    /** Idle TTL in ms; omit to disable idle shutdown. */
    ttl,
    /** Regex source tested against each output line; when it matches, notify listeners fire. */
    notifyPattern = null,
    dockerContainer = null,
    dockerPortMappings = null,
    dockerEnvKeys = null,
    taskEnvRaw = null,
    configTaskKeys = null,
    dependsOnKeys = null,
    extraEnv = null,
    interpolateOpts = null,
  }) {
    this.id = id;
    this.session_id = sessionId;
    this.command = command;
    this.label = label ?? null;
    /** `.baguette.yaml` task this was resolved from, if any. Lets a client re-run it by name. */
    this.task_key = taskKey ?? null;
    /** Who started this task: 'user' | 'agent' | 'preview'. Drives stop-turn kill scope. */
    this.origin = origin;
    this.ports = {}; // { ENV_VAR_NAME: portNumber } — populated after _startProcess()
    this._portEnvVars = Array.isArray(ports) ? ports : [];
    this._portMap = {}; // accumulated dep port assignments for interpolation
    this.pid = null;
    this.status = 'waiting';
    this.exit_code = null;
    /** Set by kill(): 'stopped' or 'ttl' (idle). null when it exited on its own. */
    this.kill_reason = null;
    this.created_at = new Date().toISOString();
    /** When status first became `running` (run timer starts here). */
    this.started_at = null;
    this.exited_at = null;
    this._env = env ?? null;
    this._cwd = cwd ?? null;
    this._logListeners = [];
    this._exitListeners = [];
    this._statusListeners = [];
    this._dependsOn = Array.isArray(dependsOn) ? dependsOn : [];
    /** Tasks that list this task in `depends_on` (reverse edges for orphan shutdown). */
    this._dependents = new Set();
    this._isRoot = Boolean(isRoot);
    for (const dep of this._dependsOn) dep.#registerDependent(this);
    this._started = false;
    /** Set when depends_on tasks have all passed waitForReady (before _startProcess). */
    this._depsSatisfied = false;
    this._ttl = ttl != null ? ttl : null;
    this._shortId = shortId;
    this._dockerContainerRaw = dockerContainer;
    this._dockerPortMappings = Array.isArray(dockerPortMappings) ? dockerPortMappings : [];
    this._dockerEnvKeys = Array.isArray(dockerEnvKeys) ? dockerEnvKeys : [];
    this._dockerContainer = null;
    this._dockerContainerName = null;
    this._taskEnvRaw =
      taskEnvRaw && typeof taskEnvRaw === 'object' && !Array.isArray(taskEnvRaw)
        ? taskEnvRaw
        : null;
    this._configTaskKeys = Array.isArray(configTaskKeys) ? configTaskKeys : [];
    this._dependsOnKeys = Array.isArray(dependsOnKeys) ? dependsOnKeys : [];
    this._extraEnv =
      extraEnv && typeof extraEnv === 'object' && !Array.isArray(extraEnv) ? extraEnv : null;
    this._interpolateOpts = interpolateOpts;
    // ── Notify monitoring (wake-ups) ────────────────────────────────────────
    this.notify_pattern = notifyPattern ?? null;
    this._notifyRegex = compileNotifyPattern(notifyPattern);
    /** Lines that matched the notify pattern (most recent last, capped). */
    this._matchedNotifyLines = [];
    /** Matches consumed by a waitForTaskEvent call; later waits only see newer matches. */
    this._consumedNotifyMatches = 0;
    /** Set when a waitForTaskEvent (or a deliberate kill) consumed this task's exit. */
    this._exitConsumed = false;
    this._pendingNotifyLine = '';
    /** fn(event) — event: { task_id, event: 'pattern'|'exit', status, exit_code, matched_line }. */
    this._notifyListeners = [];
  }

  get isDocker() {
    return this._dockerContainerRaw != null;
  }

  /** True only when .baguette.yaml defines a usable container healthcheck (not image defaults). */
  #dockerContainerHasConfiguredHealthcheck() {
    if (!this.isDocker || !this._dockerContainerRaw) return false;
    try {
      return normalizeDockerContainer(this._dockerContainerRaw).healthcheck != null;
    } catch {
      return false;
    }
  }

  get hasPorts() {
    return this._portEnvVars.length > 0;
  }

  /**
   * Reset this task's idle TTL. No-op when the task was not created with idle TTL
   * (panel-started tasks), and for tasks that have already exited.
   */
  heartbeat() {
    if (this._ttl == null || !isTaskHeartbeatEligible(this.status)) return;
    clearTimeout(this.#idleTtlTimer);
    this.#idleTtlTimer = setTimeout(() => {
      this.addLog('stdout', baguetteStatusLine('TTL expired, stopping task...'));
      this.kill({ reason: 'ttl' }).catch(() => {});
    }, this._ttl);
  }

  #heartbeatDeps() {
    for (const dep of this._dependsOn) dep.heartbeat();
  }

  #startDepHeartbeatLoop() {
    if (this._dependsOn.length === 0 || this.#heartbeatTimer != null) return;
    this.#heartbeatDeps();
    this.#heartbeatTimer = setInterval(() => this.#heartbeatDeps(), HEARTBEAT_INTERVAL_MS);
  }

  #stopDepHeartbeatLoop() {
    clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
  }

  #failStart(err) {
    const message = err instanceof Error ? err.message : String(err);
    this.addLog('stderr', `\x1b[31m──── Failed to start task "${this.label}": ${message}\x1b[0m\n`);
    this.exit(err?.exitCode ?? 1);
  }

  /**
   * Register a log listener: fn(id, stream, data). Replays accumulated buffer, then registers.
   * Returns unsubscribe.
   * @param {{ includeNestedTasks?: boolean }} opts - when true, also replay and stream the logs of
   *   the depends_on tasks (recursively). This task's own log only ever holds the pre-requisite
   *   start/finish lines; nested logs are spliced in where the dependency ran.
   */
  onLog(fn, { includeNestedTasks = false } = {}) {
    this.#replayLogs(fn, includeNestedTasks);
    return this.#addLogListener(fn, includeNestedTasks);
  }

  /** Replay the buffered logs to `fn`, expanding nested-task markers when asked. */
  #replayLogs(fn, includeNestedTasks) {
    for (const entry of this.#logBuffer) {
      if (entry.nestedTask) {
        if (includeNestedTasks) entry.nestedTask.#replayLogs(fn, true);
      } else {
        fn(this.id, entry.stream, entry.data);
      }
    }
  }

  /** Register `fn` (no replay) on this task and, optionally, its dependency tree. Returns unsubscribe. */
  #addLogListener(fn, includeNestedTasks) {
    this._logListeners.push(fn);
    const unsubs = [
      () => {
        const idx = this._logListeners.indexOf(fn);
        if (idx !== -1) this._logListeners.splice(idx, 1);
      },
    ];
    if (includeNestedTasks) {
      for (const dep of this._dependsOn) unsubs.push(dep.#addLogListener(fn, true));
    }
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }

  /** Register a status listener: fn(id, status). Returns unsubscribe. */
  onStatusChange(fn) {
    this._statusListeners.push(fn);
    return () => {
      const idx = this._statusListeners.indexOf(fn);
      if (idx !== -1) this._statusListeners.splice(idx, 1);
    };
  }

  #setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    for (const fn of this._statusListeners) fn(this.id, status);
  }

  #enterRunning() {
    if (this.started_at == null) {
      this.started_at = new Date().toISOString();
    }
    this.#setStatus('running');
  }

  /** Register an exit listener: fn(id, exitCode). Fires immediately if already exited. Returns unsubscribe. */
  onExit(fn) {
    if (isTaskTerminal(this.status)) {
      fn(this.id, this.exit_code);
      return () => {};
    }
    this._exitListeners.push(fn);
    return () => {
      const idx = this._exitListeners.indexOf(fn);
      if (idx !== -1) this._exitListeners.splice(idx, 1);
    };
  }

  /**
   * Run all depends_on tasks sequentially, then spawn this task's process.
   * Idempotent: calling start() on an already-started task is a no-op.
   */
  start() {
    if (this._started) return this;
    this._started = true;
    this.#startDepHeartbeatLoop();

    (async () => {
      try {
        if (this._dependsOn.length === 0) {
          this.#enterRunning();
        }
        for (const depTask of this._dependsOn) {
          if (!isTaskStartupContinuing(this.status)) return this;
          const depLabel = depTask.label ?? 'unlabeled';
          this.addLog(
            'stdout',
            `\x1b[2m──── Pre-requisite: ${depLabel} (task #${depTask.id})\x1b[0m\n`
          );
          // The dep's own output stays in the dep's log; this task only records that it ran.
          // Consumers that want the whole tree subscribe with { includeNestedTasks: true }.
          this.#addNestedTaskMarker(depTask);

          try {
            const depAlreadyStarted = depTask._started;
            await depTask.start();
            // Reused running deps skip start(); still (re)arm their depends_on heartbeat loop.
            if (depAlreadyStarted && depTask._dependsOn.length > 0) {
              depTask.#startDepHeartbeatLoop();
            }
            await depTask.waitForReady();
          } catch (err) {
            // Reported here rather than by the outer catch: the dep name and its task id are what
            // point at the log that actually holds the error.
            this.addLog(
              'stderr',
              `\x1b[31m──── Pre-requisite failed: ${depLabel} (task #${depTask.id}): ${err.message}\x1b[0m\n`
            );
            this.exit(err.exitCode ?? 1);
            return this;
          }

          if (!isTaskStartupContinuing(this.status)) return this;

          if (depTask._portMap && typeof depTask._portMap === 'object') {
            for (const [depKey, depPorts] of Object.entries(depTask._portMap)) {
              this._portMap[depKey] = depPorts;
            }
          }
          const depPortMapKey = depTask.task_key || depTask.label;
          if (depPortMapKey && Object.keys(depTask.ports).length > 0) {
            this._portMap[depPortMapKey] = depTask.ports;
          }
          if (depTask.isDocker && depTask.task_key && depTask._shortId) {
            const depKey = depTask.task_key;
            const containerImage = depTask._dockerContainer?.image;
            this._portMap[depKey] = {
              ...(this._portMap[depKey] ?? {}),
              container_hostname: dockerContainerHostname(depTask._shortId, depTask.task_key),
              ...(containerImage ? { container_image: containerImage } : {}),
            };
          }
          const word = depTask._portEnvVars.length > 0 ? 'ready' : 'completed';
          this.addLog('stdout', `\x1b[2m──── Pre-requisite ${word}: ${depLabel}\x1b[0m\n`);
        }

        if (!isTaskStartupContinuing(this.status)) return this;

        if (this._taskEnvRaw) {
          try {
            const taskEnv = resolveTaskEnv(this._taskEnvRaw, {
              interpolateOpts: this._interpolateOpts,
              portMap: this._portMap,
              configTaskKeys: this._configTaskKeys,
              dependsOnKeys: this._dependsOnKeys,
            });
            this._env = { ...(this._env ?? {}), ...taskEnv };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.addLog(
              'stderr',
              `\x1b[31m──── Failed to resolve task environment: ${message}\x1b[0m\n`
            );
            this.exit(1);
            return this;
          }
        }

        if (this._extraEnv) {
          this._env = { ...(this._env ?? {}), ...this._extraEnv };
        }

        if (Object.keys(this._portMap).length > 0) {
          this.command = interpolateConfigTaskPorts(this.command, this._portMap);
          if (this.isDocker && this._dockerContainerRaw) {
            this._dockerContainerRaw = interpolateConfigTaskPorts(
              this._dockerContainerRaw,
              this._portMap
            );
          }
        }

        this._depsSatisfied = true;
        this.#enterRunning();
        await this._startProcess();
      } catch (err) {
        this.#failStart(err);
      }
    })().catch((err) => {
      if (this.status === 'running') this.#failStart(err);
    });
  }

  /**
   * Wait until this task is "ready":
   * - No ports: resolves when the process exits 0; rejects on non-zero exit.
   * - With ports: resolves when listening on allocated host ports.
   * - Docker: resolves when the container has started, or when healthy if a healthcheck is
   *   configured in .baguette.yaml (host TCP probes are not used). Rejects if the process
   *   exits first or the timeout elapses after
   *   readiness probing begins. Init, depends_on, image pull/build, and container start
   *   are not counted — probing starts only after depends_on are ready and this task has
   *   finished starting its process/container.
   * Resolves immediately if already succeeded; rejects immediately if already failed.
   * `timeout` is accepted as an alias of `timeoutMs`.
   */
  async waitForReady({ timeoutMs, timeout, pollMs = 500 } = {}) {
    const readyTimeoutMs = timeoutMs ?? timeout ?? 60_000;
    const hasDockerHealthcheck = this.#dockerContainerHasConfiguredHealthcheck();
    const isPortDep = this._portEnvVars.length > 0 || this.isDocker;

    if (isTaskTerminal(this.status)) {
      if (isPortDep || this.exit_code !== 0) {
        throw Object.assign(
          new Error(
            `"${this.label ?? 'task'}" ${isPortDep ? 'exited before ports were ready' : `failed with exit code ${this.exit_code}`}`
          ),
          { exitCode: this.exit_code }
        );
      }
      return; // already succeeded
    }

    if (!isPortDep) {
      // Short-lived dep: wait for exit
      return new Promise((resolve, reject) => {
        this.onExit((_id, code) => {
          if (code !== 0)
            reject(
              Object.assign(new Error(`"${this.label ?? 'task'}" failed with exit code ${code}`), {
                exitCode: code,
              })
            );
          else resolve();
        });
      });
    }

    // Port dep: poll isPortListening, fail fast if process exits first.
    // Do not start the listen timeout until ports are allocated — init/depends_on
    // can take longer than readyTimeoutMs (e.g. pnpm install on first preview start).
    let exitReject;
    const exitPromise = new Promise((_, reject) => {
      exitReject = reject;
    });
    const unsubExit = this.onExit((_id, code) =>
      exitReject(
        Object.assign(new Error(`"${this.label ?? 'task'}" exited before ports were ready`), {
          exitCode: code,
        })
      )
    );

    const pollPromise = (async () => {
      while (this._dependsOn.length > 0 && !this._depsSatisfied) {
        if (isTaskTerminal(this.status)) {
          throw Object.assign(
            new Error(`"${this.label ?? 'task'}" exited before depends_on tasks were ready`),
            { exitCode: this.exit_code }
          );
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      if (this._portEnvVars.length) {
        while (Object.keys(this.ports).length !== this._portEnvVars.length) {
          if (isTaskTerminal(this.status)) {
            throw Object.assign(
              new Error(`"${this.label ?? 'task'}" exited before ports were ready`),
              { exitCode: this.exit_code }
            );
          }
          await new Promise((r) => setTimeout(r, pollMs));
        }
      }
      if (this.isDocker) {
        while (!this._dockerContainerName) {
          if (isTaskTerminal(this.status)) {
            throw Object.assign(
              new Error(`"${this.label ?? 'task'}" exited before container started`),
              { exitCode: this.exit_code }
            );
          }
          await new Promise((r) => setTimeout(r, pollMs));
        }
        if (hasDockerHealthcheck) {
          await waitForContainerHealth(this._dockerContainerName, {
            timeoutMs: readyTimeoutMs,
            pollMs,
          });
        }
        return;
      }
      const deadline = Date.now() + readyTimeoutMs;
      while (Date.now() < deadline) {
        const results = await Promise.all(Object.values(this.ports).map(isPortListening));
        if (results.every(Boolean)) return;
        await new Promise((r) => setTimeout(r, pollMs));
      }
      throw new Error(`"${this.label ?? 'task'}" ports not ready after ${readyTimeoutMs}ms`);
    })();

    try {
      return await Promise.race([pollPromise, exitPromise]);
    } finally {
      unsubExit();
    }
  }

  /** Allocate ports and spawn the child process. */
  async _startProcess() {
    // Allocate a free port for each requested env var
    const portAssignments = {};
    for (const envVar of this._portEnvVars) {
      portAssignments[envVar] = await getFreePort();
    }
    this.ports = portAssignments;

    // Merge port numbers (as strings) into the process env.
    const fullEnv = { ...this._env };
    for (const [key, port] of Object.entries(portAssignments)) {
      fullEnv[key] = String(port);
    }

    if (this.isDocker) {
      await this._startDockerProcess(fullEnv, portAssignments);
      return this;
    }

    let scriptPath = null;
    let argv = ['sh', ['-c', this.command]];
    if (this.command.includes('\n')) {
      const script = await writeScriptFile(this.id, this.command);
      scriptPath = script.path;
      argv = script.argv;
    }

    const spawnOpts = {
      cwd: this._cwd,
      env: fullEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    };
    const child = spawn(argv[0], argv[1], spawnOpts);

    this.pid = child.pid;
    this.#process = child;

    const handleData = (stream) => (data) => {
      const line = data.toString();
      this.addLog(stream, line);
    };

    child.stdout.on('data', handleData('stdout'));
    child.stderr.on('data', handleData('stderr'));

    child.on('exit', (code, signal) => {
      if (scriptPath) unlink(scriptPath).catch(() => {});
      const exitCode = code ?? (signal ? 1 : 0);
      this.#process = null;
      detachChildProcess(child);
      this.exit(exitCode);
    });

    this.heartbeat();
    return this;
  }

  async _startDockerProcess(fullEnv, _portAssignments) {
    if (!this._shortId || !this.task_key) {
      throw new Error('Docker tasks require session short_id and task_key');
    }
    let container = normalizeDockerContainer(this._dockerContainerRaw);
    const onDockerOutput = (stream, data) => this.addLog(stream, data);

    if (container.build) {
      const tagHint = container.image ?? this.task_key ?? 'image';
      this.addLog('stdout', baguetteStatusLine(`Building docker image (${tagHint})…`));
      const tag = await buildDockerImage({
        shortId: this._shortId,
        taskKey: this.task_key,
        build: container.build,
        imageTag: container.image,
        cwd: this._cwd,
        onOutput: onDockerOutput,
      });
      this.addLog('stdout', baguetteStatusLine(`Finished building docker image (${tag})`));
      container = { ...container, image: tag, build: null };
    }
    this._dockerContainer = container;

    const runLabel = container.image ?? 'container';
    this.addLog('stdout', baguetteStatusLine(`Running docker container (${runLabel})…`));
    const dockerEnv = buildDockerRunEnv(
      fullEnv,
      this._dockerEnvKeys,
      this._extraEnv,
      this._portEnvVars
    );
    const { child, containerName } = await spawnDockerContainer({
      shortId: this._shortId,
      taskKey: this.task_key,
      container,
      taskEnvKeys: Object.keys(dockerEnv),
      env: dockerEnv,
    });
    this._dockerContainerName = containerName;
    this.#process = child;
    this.pid = child.pid;

    const handleData = (stream) => (data) => {
      this.addLog(stream, data.toString());
    };
    child.stdout.on('data', handleData('stdout'));
    child.stderr.on('data', handleData('stderr'));

    child.on('exit', (code, signal) => {
      this.#process = null;
      this._dockerContainerName = null;
      detachChildProcess(child);
      const exitCode = code ?? (signal ? 1 : 0);
      this.exit(exitCode);
    });

    child.on('error', (err) => {
      this.addLog('stderr', `${err.message}\n`);
      this.exit(1);
    });

    this.heartbeat();
    return this;
  }

  #waitForChildExit({ timeoutMs }) {
    if (this.status !== 'exiting' || !this.#process) {
      return Promise.resolve();
    }
    const child = this.#process;
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        child.removeListener('exit', done);
        resolve();
      }, timeoutMs);
      child.once('exit', done);
    });
  }

  #killProcessGroup(signal) {
    if (!this.#process) return;
    try {
      process.kill(-this.#process.pid, signal);
    } catch {
      // Fall back to killing just the process (e.g. if pgid no longer exists)
      try {
        this.#process.kill(signal);
      } catch {
        /* already gone */
      }
    }
  }

  #registerDependent(task) {
    this._dependents.add(task);
  }

  #removeDependent(task) {
    this._dependents.delete(task);
  }

  #hasActiveDependents() {
    for (const t of this._dependents) {
      if (!isTaskTerminal(t.status)) return true;
    }
    return false;
  }

  /**
   * After a dependent exits, stop this task when it was only started for that chain.
   * @param {{ reason?: 'stopped'|'ttl'|null }} opts
   */
  #tryStopIfOrphan({ reason = null } = {}) {
    if (this._isRoot || this.#hasActiveDependents()) return;
    if (isTaskTerminal(this.status)) return;
    if (!this._started) {
      this.#cancelUnstartedDependsOnSubtree({ reason });
      return;
    }
    if (isTaskStoppable(this.status)) {
      void this.kill({ reason: reason ?? 'stopped' }).catch(() => {});
    }
  }

  /**
   * End depends_on tasks that never had `start()` called (and their nested trees).
   * @param {{ reason?: 'stopped'|'ttl'|null }} opts - forwarded from `kill()`; omit on natural parent exit.
   */
  #cancelUnstartedDependsOnSubtree({ reason = null } = {}) {
    if (isTaskTerminal(this.status)) return;
    if (!this._started) {
      if (reason) this.kill_reason = reason;
      for (const nested of [...this._dependsOn].reverse()) {
        nested.#removeDependent(this);
        nested.#tryStopIfOrphan({ reason });
      }
      this.exit(0);
    }
  }

  #releaseDependsOn({ reason = null } = {}) {
    for (const dep of [...this._dependsOn].reverse()) {
      dep.#removeDependent(this);
      dep.#tryStopIfOrphan({ reason });
    }
  }

  /**
   * Send SIGTERM; escalate to SIGKILL after `graceMs` if still running; await until the child exits or `timeoutMs`.
   * @param {{ timeoutMs?: number, graceMs?: number, reason?: 'stopped'|'ttl' }} opts - `reason` is recorded on the task so
   *   consumers can tell a deliberate stop from a crash (see DevProxy exit handling).
   * @returns {Promise<boolean>} true if a signal was sent, false if already exited/no process.
   */
  async kill({ timeoutMs, graceMs = KILL_GRACE_MS, reason = 'stopped' } = {}) {
    const waitMs = timeoutMs ?? graceMs + 5_000;
    if (!isTaskStoppable(this.status)) {
      return false;
    }
    // Deliberate kills consume the exit: a stopped monitored task owes no wake-up.
    this._exitConsumed = true;
    this.kill_reason = reason;
    this.#setStatus('exiting');
    const graceSec = graceMs / 1000;
    if (reason === 'stopped') {
      this.addLog(
        'stdout',
        baguetteStatusLine(
          `Stopped manually (SIGTERM; force kill after ${graceSec}s if still running)`
        )
      );
    } else if (reason === 'ttl') {
      this.addLog(
        'stdout',
        baguetteStatusLine(`TTL expired (SIGTERM; force kill after ${graceSec}s if still running)`)
      );
    }
    // Cancel before the child exists (still in init/depends_on) or if the child
    // already vanished without an exit event — otherwise the task stays "running"
    // forever and the Preview Start button stays disabled.
    if (!this.#process) {
      if (this._dockerContainerName) {
        await stopDockerContainer(this._dockerContainerName);
        this._dockerContainerName = null;
      }
      this.exit(0);
      return true;
    }
    this.#killProcessGroup('SIGTERM');
    const escalation = setTimeout(() => {
      if (this.status === 'exiting' && this.#process) {
        this.addLog(
          'stdout',
          baguetteStatusLine('Still running after grace period, sending SIGKILL...')
        );
        this.#killProcessGroup('SIGKILL');
      }
    }, graceMs);
    try {
      await this.#waitForChildExit({ timeoutMs: waitMs });
    } finally {
      clearTimeout(escalation);
    }
    if (this._dockerContainerName) {
      await stopDockerContainer(this._dockerContainerName).catch(() => {});
      this._dockerContainerName = null;
    }
    return true;
  }

  /** Force-kill immediately (SIGKILL). */
  forceKill() {
    if (this.#process) {
      this.#killProcessGroup('SIGKILL');
    }
  }

  /** Register a notify listener: fn(event). Fires on pattern matches and on exit. */
  onNotify(fn) {
    this._notifyListeners.push(fn);
    return () => {
      const idx = this._notifyListeners.indexOf(fn);
      if (idx !== -1) this._notifyListeners.splice(idx, 1);
    };
  }

  /** Emit a notify event to all listeners. */
  #emitNotify(event) {
    for (const fn of this._notifyListeners) fn(event);
  }

  /**
   * Test completed output lines against the notify pattern. Chunks can split lines,
   * so a pending partial line is buffered until its newline arrives.
   */
  #consumeNotifyLines(data) {
    if (!this._notifyRegex || isTaskTerminal(this.status)) return;
    this._pendingNotifyLine += data;
    const lines = this._pendingNotifyLine.split(/\r?\n/);
    this._pendingNotifyLine = lines.pop() ?? '';
    for (const line of lines) {
      if (!this._notifyRegex.test(line)) continue;
      const matched = line.slice(0, 500);
      this._matchedNotifyLines.push(matched);
      if (this._matchedNotifyLines.length > MAX_NOTIFY_MATCHES) this._matchedNotifyLines.shift();
      this.#emitNotify({
        task_id: this.id,
        event: 'pattern',
        status: this.status,
        exit_code: null,
        matched_line: matched,
      });
    }
  }

  /** Inject a synthetic log line (e.g. a status message before the process starts). */
  addLog(stream, data) {
    this.#pushLogEntry({ stream, data });
    this.#consumeNotifyLines(data);
    for (const fn of this._logListeners) fn(this.id, stream, data);
  }

  /**
   * Record the position of a dependency in the log buffer so `{ includeNestedTasks: true }`
   * consumers can splice its output back in at the right place. Nothing is emitted to listeners:
   * nested subscribers are already attached to the dep itself.
   */
  #addNestedTaskMarker(task) {
    this.#pushLogEntry({ nestedTask: task });
  }

  #pushLogEntry(entry) {
    this.#logBuffer.push(entry);
    if (this.#logBuffer.length > 10000) this.#logBuffer.shift();
  }

  /** Mark the task as failed without a running process. */
  exit(exitCode = 1) {
    if (isTaskTerminal(this.status)) return;
    this.#releaseDependsOn({ reason: this.kill_reason });
    clearTimeout(this.#idleTtlTimer);
    this.#stopDepHeartbeatLoop();
    this.exit_code = exitCode;
    this.exited_at = new Date().toISOString();
    const finalStatus = this.kill_reason === 'stopped' ? 'stopped' : 'exited';
    this.#setStatus(finalStatus);
    this.#emitNotify({
      task_id: this.id,
      event: 'exit',
      status: finalStatus,
      exit_code: exitCode,
      matched_line: null,
    });
    for (const fn of this._exitListeners) fn(this.id, exitCode);
  }

  /** Return the full log buffer as a single string.
   * @param {{ includeNestedTasks?: boolean }} opts - when true, splice in the logs of the
   *   depends_on tasks (recursively) where each dependency ran.
   */
  getLogs({ includeNestedTasks = false } = {}) {
    let out = '';
    for (const entry of this.#logBuffer) {
      if (entry.nestedTask) {
        if (includeNestedTasks) out += entry.nestedTask.getLogs({ includeNestedTasks: true });
      } else {
        out += entry.data;
      }
    }
    return out;
  }

  /** Return the last `maxBytes` of the task's log (characters). */
  tailLogs(maxBytes = 4000) {
    const logs = this.getLogs();
    if (logs.length <= maxBytes) return logs;
    return logs.slice(-maxBytes);
  }

  /**
   * True while this monitored task still owes the agent a wake-up: it is active, or
   * it exited/finalised without its exit event having been delivered yet. Deliberate
   * kills (kill()) consume the exit so stopped tasks don't nag future turns.
   */
  isNotifyPending() {
    if (!this.notify_pattern) return false;
    if (!isTaskTerminal(this.status)) return true;
    return !this._exitConsumed;
  }

  /** Return a plain public object (no private fields). */
  toPublic() {
    return {
      id: this.id,
      session_id: this.session_id,
      command: this.command,
      label: this.label,
      task_key: this.task_key,
      origin: this.origin,
      pid: this.pid,
      status: this.status,
      exit_code: this.exit_code,
      kill_reason: this.kill_reason,
      created_at: this.created_at,
      started_at: this.started_at,
      exited_at: this.exited_at,
      ports: this.ports,
      ttl_ms: this._ttl,
      is_docker: this.isDocker,
      notify_pattern: this.notify_pattern,
      pattern_matched: this._matchedNotifyLines.length > this._consumedNotifyMatches,
      has_matched: this._matchedNotifyLines.length > 0,
      notify_pending: this.isNotifyPending(),
    };
  }
}
