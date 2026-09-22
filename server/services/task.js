import { spawn } from 'child_process';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import net from 'net';
import { interpolateTaskPorts } from './baguette-config.js';
import { isPortListening } from './port-utils.js';

/** Idle lifetime for tasks that expose ports. Reset by heartbeat(). */
export const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** Idle lifetime for preview-tab webserver starts (matches proxy cookie TTL). */
export const PREVIEW_WEBSERVICE_TTL_MS = 60 * 60 * 1000; // 1 hour
/** How often a task heartbeats its depends_on tasks. */
export const HEARTBEAT_INTERVAL_MS = 60 * 1000;

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
  #ttlTimer = null;
  #heartbeatTimer = null;

  constructor({
    id,
    sessionId,
    command,
    label,
    taskKey,
    ports,
    env,
    cwd,
    dependsOn,
    noTtl = false,
    ttlMs,
  }) {
    this.id = id;
    this.session_id = sessionId;
    this.command = command;
    this.label = label ?? null;
    /** `.baguette.yaml` task this was resolved from, if any. Lets a client re-run it by name. */
    this.task_key = taskKey ?? null;
    this.ports = {}; // { ENV_VAR_NAME: portNumber } — populated after _startProcess()
    this._portEnvVars = Array.isArray(ports) ? ports : [];
    this._portMap = {}; // accumulated dep port assignments for interpolation
    this.pid = null;
    this.status = 'running';
    this.exit_code = null;
    /** Set by kill(): 'stopped' (explicit stop) or 'ttl' (idle timeout). null when it exited on its own. */
    this.kill_reason = null;
    this.created_at = new Date().toISOString();
    this._env = env ?? null;
    this._cwd = cwd ?? null;
    this._logListeners = [];
    this._exitListeners = [];
    this._dependsOn = Array.isArray(dependsOn) ? dependsOn : [];
    this._started = false;
    this._noTtl = !!noTtl;
    this._ttlMs = noTtl ? null : (ttlMs ?? DEFAULT_TTL_MS);
  }

  get hasPorts() {
    return this._portEnvVars.length > 0;
  }

  /**
   * Reset this task's idle TTL. No-op for tasks without ports
   * (they run until cancelled or they exit) and for tasks that have already exited.
   */
  heartbeat() {
    if (this.status === 'exited' || !this.hasPorts || !this._ttlMs) return;
    clearTimeout(this.#ttlTimer);
    this.#ttlTimer = setTimeout(() => {
      this.addLog('stdout', `\x1b[33m[baguette] TTL expired, stopping task...\x1b[0m\n`);
      this.kill({ reason: 'ttl' }).catch(() => {});
    }, this._ttlMs);
  }

  #heartbeatDeps() {
    for (const dep of this._dependsOn) dep.heartbeat();
  }

  #startDepHeartbeatLoop() {
    if (this._dependsOn.length === 0) return;
    this.#heartbeatDeps();
    this.#heartbeatTimer = setInterval(() => this.#heartbeatDeps(), HEARTBEAT_INTERVAL_MS);
  }

  #stopDepHeartbeatLoop() {
    clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
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

  /** Register an exit listener: fn(id, exitCode). Fires immediately if already exited. Returns unsubscribe. */
  onExit(fn) {
    if (this.status === 'exited') {
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
        for (const depTask of this._dependsOn) {
          if (this.status !== 'running') return this;
          const depLabel = depTask.label ?? 'unlabeled';
          this.addLog(
            'stdout',
            `\x1b[2m──── Pre-requisite: ${depLabel} (task #${depTask.id})\x1b[0m\n`
          );
          // The dep's own output stays in the dep's log; this task only records that it ran.
          // Consumers that want the whole tree subscribe with { includeNestedTasks: true }.
          this.#addNestedTaskMarker(depTask);

          try {
            await depTask.start();
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

          if (this.status !== 'running') return this;

          if (depTask.label && Object.keys(depTask.ports).length > 0) {
            this._portMap[depTask.label] = depTask.ports;
          }
          const word = depTask._portEnvVars.length > 0 ? 'ready' : 'completed';
          this.addLog('stdout', `\x1b[2m──── Pre-requisite ${word}: ${depLabel}\x1b[0m\n`);
        }

        if (this.status !== 'running') return this;

        if (Object.keys(this._portMap).length > 0) {
          this.command = interpolateTaskPorts(this.command, this._portMap);
        }

        return this._startProcess();
      } catch (err) {
        this.addLog(
          'stderr',
          `\x1b[31m──── Failed to start task "${this.label}": ${err.message}\x1b[0m\n`
        );
        this.exit(err.exitCode ?? 1);
        return this;
      }
    })();
  }

  /**
   * Wait until this task is "ready":
   * - No ports: resolves when the process exits 0; rejects on non-zero exit.
   * - With ports: resolves when all ports are accepting connections; rejects if the process
   *   exits before they're ready, or if the timeout elapses after ports are allocated.
   *   Init/depends_on time is not counted against the timeout (ports are assigned only
   *   after those complete).
   * Resolves immediately if already succeeded; rejects immediately if already failed.
   * `timeout` is accepted as an alias of `timeoutMs`.
   */
  async waitForReady({ timeoutMs, timeout, pollMs = 500 } = {}) {
    const readyTimeoutMs = timeoutMs ?? timeout ?? 60_000;
    const isPortDep = this._portEnvVars.length > 0;

    if (this.status === 'exited') {
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
      while (Object.keys(this.ports).length !== this._portEnvVars.length) {
        await new Promise((r) => setTimeout(r, pollMs));
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

  #waitForChildExit({ timeoutMs }) {
    if (this.status !== 'running' || !this.#process) {
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

  /**
   * Send SIGTERM; escalate to SIGKILL after 5 s if still running; await until the child exits or `timeoutMs`.
   * @param {{ timeoutMs?: number, reason?: 'stopped'|'ttl' }} opts - `reason` is recorded on the task so
   *   consumers can tell a deliberate stop from a crash (see DevProxy exit handling).
   * @returns {Promise<boolean>} true if a signal was sent, false if already exited/no process.
   */
  async kill({ timeoutMs = 12000, reason = 'stopped' } = {}) {
    if (this.status !== 'running') {
      return false;
    }
    this.kill_reason = reason;
    // Cancel before the child exists (still in init/depends_on) or if the child
    // already vanished without an exit event — otherwise the task stays "running"
    // forever and the Preview Start button stays disabled.
    if (!this.#process) {
      for (const dep of this._dependsOn) {
        await dep.kill().catch(() => {});
      }
      this.exit(0);
      return true;
    }
    this.#killProcessGroup('SIGTERM');
    const escalation = setTimeout(() => {
      if (this.status === 'running' && this.#process) {
        this.#killProcessGroup('SIGKILL');
      }
    }, 10000);
    try {
      await this.#waitForChildExit({ timeoutMs });
    } finally {
      clearTimeout(escalation);
    }
    return true;
  }

  /** Force-kill immediately (SIGKILL). */
  forceKill() {
    if (this.#process) {
      this.#killProcessGroup('SIGKILL');
    }
  }

  /** Inject a synthetic log line (e.g. a status message before the process starts). */
  addLog(stream, data) {
    this.#pushLogEntry({ stream, data });
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
    if (this.status === 'exited') return;
    clearTimeout(this.#ttlTimer);
    this.#stopDepHeartbeatLoop();
    this.status = 'exited';
    this.exit_code = exitCode;
    for (const fn of this._exitListeners) fn(this.id, exitCode);
  }

  /**
   * Return the full log buffer as a single string.
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

  /** Return a plain public object (no private fields). */
  toPublic() {
    return {
      id: this.id,
      session_id: this.session_id,
      command: this.command,
      label: this.label,
      task_key: this.task_key,
      pid: this.pid,
      status: this.status,
      exit_code: this.exit_code,
      created_at: this.created_at,
      ports: this.ports,
      ttl_ms: this.hasPorts && this._ttlMs ? this._ttlMs : null,
      no_ttl: this._noTtl,
    };
  }
}
