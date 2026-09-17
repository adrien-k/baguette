import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import net from 'net';
import { interpolateTaskPorts } from './baguette-config.js';
import { isPortListening } from './port-utils.js';

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
 * Instantiated by TasksService; emits events back through the injected taskService.
 */
export class Task {
  #process = null;
  #logBuffer = [];
  #taskService;

  constructor({ id, sessionId, command, label, ports, taskService, env, cwd, dependsOn }) {
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
    this.#taskService = taskService;
    this._env = env ?? null;
    this._cwd = cwd ?? null;
    this._logListeners = [];
    this._exitListeners = [];
    this._dependsOn = Array.isArray(dependsOn) ? dependsOn : [];
    this._started = false;
  }

  /** Register a log listener: fn(id, stream, data). Replays accumulated buffer, then registers. */
  onLog(fn) {
    for (const { stream, data } of this.#logBuffer) fn(this.id, stream, data);
    this._logListeners.push(fn);
    return this;
  }

  /** Register an exit listener: fn(id, exitCode). Fires immediately if already exited. */
  onExit(fn) {
    if (this.status === 'exited') fn(this.id, this.exit_code);
    else this._exitListeners.push(fn);
    return this;
  }

  /**
   * Run all depends_on tasks sequentially, then spawn this task's process.
   * Idempotent: calling start() on an already-started task is a no-op.
   */
  async start() {
    if (this._started) return this;
    this._started = true;

    for (const depTask of this._dependsOn) {
      const depLabel = depTask.label ?? 'unlabeled';
      this.addLog('stdout', `\x1b[2m──── Pre-requisite: ${depLabel}\x1b[0m\n`);
      depTask.onLog((_id, stream, data) => this.addLog(stream, data));

      try {
        await depTask.start();
        await depTask.waitForReady();
      } catch (err) {
        this.addLog('stderr', `\x1b[31m──── Pre-requisite "${depLabel}" failed: ${err.message}\x1b[0m\n`);
        this.fail(err.exitCode ?? 1);
        return this;
      }

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
          new Error(`"${this.label ?? 'task'}" ${isPortDep ? 'exited before ports were ready' : `failed with exit code ${this.exit_code}`}`),
          { exitCode: this.exit_code }
        );
      }
      return; // already succeeded
    }

    if (!isPortDep) {
      // Short-lived dep: wait for exit
      return new Promise((resolve, reject) => {
        this.onExit((_id, code) => {
          if (code !== 0) reject(Object.assign(new Error(`"${this.label ?? 'task'}" failed with exit code ${code}`), { exitCode: code }));
          else resolve();
        });
      });
    }

    // Port dep: poll isPortListening, fail fast if process exits first
    const portValues = Object.values(this.ports);
    const deadline = Date.now() + timeoutMs;

    let exitReject;
    const exitPromise = new Promise((_, reject) => { exitReject = reject; });
    const exitHandler = (_id, code) =>
      exitReject(Object.assign(new Error(`"${this.label ?? 'task'}" exited before ports were ready`), { exitCode: code }));
    this._exitListeners.push(exitHandler);

    const pollPromise = (async () => {
      while (Date.now() < deadline) {
        const results = await Promise.all(portValues.map(isPortListening));
        if (results.every(Boolean)) return;
        await new Promise((r) => setTimeout(r, pollMs));
      }
      throw new Error(`"${this.label ?? 'task'}" ports not ready after ${timeoutMs}ms`);
    })();

    try {
      return await Promise.race([pollPromise, exitPromise]);
    } finally {
      const idx = this._exitListeners.indexOf(exitHandler);
      if (idx !== -1) this._exitListeners.splice(idx, 1);
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

    const spawnOpts = { cwd: this._cwd, env: fullEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: true };
    const child = scriptPath
      ? spawn('sh', [scriptPath], spawnOpts)
      : spawn('sh', ['-c', this.command], spawnOpts);

    this.pid = child.pid;
    this.#process = child;

    const handleData = (stream) => (data) => {
      const line = data.toString();
      this.#logBuffer.push({ stream, data: line });
      if (this.#logBuffer.length > 10000) this.#logBuffer.shift();
      for (const fn of this._logListeners) fn(this.id, stream, line);
      this.#taskService?.emit('log', {
        id: this.id,
        session_id: this.session_id,
        stream,
        data: line,
      });
    };

    child.stdout.on('data', handleData('stdout'));
    child.stderr.on('data', handleData('stderr'));

    child.on('exit', (code, signal) => {
      if (scriptPath) unlink(scriptPath).catch(() => {});
      const exitCode = code ?? (signal ? 1 : 0);
      this.status = 'exited';
      this.exit_code = exitCode;
      this.#process = null;
      detachChildProcess(child);
      for (const fn of this._exitListeners) fn(this.id, exitCode);
      this.#taskService?.emit('patched', this.toPublic());
    });

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
      try { this.#process.kill(signal); } catch { /* already gone */ }
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
    this.#taskService?.emit('log', {
      id: this.id,
      session_id: this.session_id,
      stream,
      data,
    });
  }

  /** Mark the task as failed without a running process. */
  fail(exitCode = 1) {
    if (this.status === 'exited') return;
    this.status = 'exited';
    this.exit_code = exitCode;
    this.#taskService?.emit('patched', this.toPublic());
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
    };
  }
}
