import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
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

  constructor({ id, sessionId, command, label, ports, env, cwd, dependsOn, noTtl = false, ttlMs }) {
    this.id = id;
    this.session_id = sessionId;
    this.command = command;
    this.label = label ?? null;
    this.ports = {}; // { ENV_VAR_NAME: portNumber } — populated after _startProcess()
    this._portEnvVars = Array.isArray(ports) ? ports : [];
    this._portMap = {}; // accumulated dep port assignments for interpolation
    this.pid = null;
    this.status = 'running';
    this.exit_code = null;
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
      this.kill().catch(() => {});
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

  /** Register a log listener: fn(id, stream, data). Replays accumulated buffer, then registers. Returns unsubscribe. */
  onLog(fn) {
    for (const { stream, data } of this.#logBuffer) fn(this.id, stream, data);
    this._logListeners.push(fn);
    return () => {
      const idx = this._logListeners.indexOf(fn);
      if (idx !== -1) this._logListeners.splice(idx, 1);
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
          const depLabel = depTask.label ?? 'unlabeled';
          this.addLog('stdout', `\x1b[2m──── Pre-requisite: ${depLabel}\x1b[0m\n`);
          const unsubDepLog = depTask.onLog((_id, stream, data) => this.addLog(stream, data));

          await depTask.start();
          await depTask.waitForReady();
          unsubDepLog();

          if (depTask.label && Object.keys(depTask.ports).length > 0) {
            this._portMap[depTask.label] = depTask.ports;
          }
          const word = depTask._portEnvVars.length > 0 ? 'ready' : 'completed';
          this.addLog('stdout', `\x1b[2m──── Pre-requisite ${word}: ${depLabel}\x1b[0m\n`);
        }

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
   *   exits before they're ready, or if the timeout elapses.
   * Resolves immediately if already succeeded; rejects immediately if already failed.
   */
  async waitForReady({ timeoutMs = 60_000, pollMs = 500 } = {}) {
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

    // Port dep: poll isPortListening, fail fast if process exits first
    const deadline = Date.now() + timeoutMs;

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
      while (Date.now() < deadline) {
        const portValues = Object.values(this.ports);
        // Only check ports once they are allocated
        if (portValues.length === this._portEnvVars.length) {
          const results = await Promise.all(portValues.map(isPortListening));
          if (results.every(Boolean)) return;
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      throw new Error(`"${this.label ?? 'task'}" ports not ready after ${timeoutMs}ms`);
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
    if (this.command.includes('\n')) {
      scriptPath = join(tmpdir(), `baguette-task-${this.id}-${Date.now()}.sh`);
      await writeFile(scriptPath, `#!/bin/sh\nset -e\n${this.command}\n`, 'utf8');
    }

    const spawnOpts = {
      cwd: this._cwd,
      env: fullEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    };
    const child = scriptPath
      ? spawn('sh', [scriptPath], spawnOpts)
      : spawn('sh', ['-c', this.command], spawnOpts);

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
   * @returns {Promise<boolean>} true if a signal was sent, false if already exited/no process.
   */
  async kill({ timeoutMs = 12000 } = {}) {
    if (this.status !== 'running' || !this.#process) {
      return false;
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
    this.#logBuffer.push({ stream, data });
    if (this.#logBuffer.length > 10000) this.#logBuffer.shift();
    for (const fn of this._logListeners) fn(this.id, stream, data);
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

  /** Return the full log buffer as a single string. */
  getLogs() {
    return this.#logBuffer.map((e) => e.data).join('');
  }

  /** Return a plain public object (no private fields). */
  toPublic() {
    return {
      id: this.id,
      session_id: this.session_id,
      command: this.command,
      label: this.label,
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
