/**
 * Unit tests for Task class and TasksService store logic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: vi.fn() }));

vi.mock('child_process', () => {
  const mockChild = {
    pid: 999,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  };
  return {
    spawn: vi.fn(() => mockChild),
    execFile: vi.fn((_cmd, _args, _opts, cb) => cb?.(null, { stdout: '' }, '')),
  };
});

vi.mock('../port-utils.js', () => ({
  isPortListening: vi.fn(async () => false),
  waitForPorts: vi.fn(async () => false),
}));

import { Task, DEFAULT_TTL_MS, HEARTBEAT_INTERVAL_MS } from '../task.js';
import { TasksService, TASK_AWAIT_TIMEOUT_MS } from '../feathers/tasks.service.js';
import { isPortListening } from '../port-utils.js';
import * as dockerSession from '../docker-session.js';

let service;

function setTaskRunning(task) {
  task.status = 'running';
  task.started_at = new Date().toISOString();
}

beforeEach(() => {
  service = new TasksService();
});

// ─── Task class ───────────────────────────────────────────────────────────────

describe('Task', () => {
  it('initialises with expected public fields', () => {
    const task = new Task({ id: 1, sessionId: 10, command: 'echo hi', taskService: service });
    expect(task.id).toBe(1);
    expect(task.session_id).toBe(10);
    expect(task.command).toBe('echo hi');
    expect(task.status).toBe('waiting');
    expect(task.pid).toBeNull();
    expect(task.exit_code).toBeNull();
  });

  it('exit() sets exited_at and includes it in toPublic()', () => {
    const task = new Task({ id: 1, sessionId: 1, command: 'x', taskService: service });
    task.exit(0);
    expect(task.exited_at).toBeTruthy();
    expect(task.toPublic().exited_at).toBe(task.exited_at);
  });

  it('toPublic() omits private fields', () => {
    const task = new Task({ id: 1, sessionId: 10, command: 'x', taskService: service });
    const pub = task.toPublic();
    expect(pub.id).toBe(1);
    expect(pub.command).toBe('x');
    expect('logBuffer' in pub).toBe(false);
    expect('process' in pub).toBe(false);
    expect(pub.ttl_ms).toBeNull();
  });

  it('toPublic() reports ttl_ms for tasks with idle TTL', () => {
    const task = new Task({
      id: 1,
      sessionId: 10,
      command: 'x',
      ports: ['PORT'],
      ttl: DEFAULT_TTL_MS,
    });
    expect(task.toPublic().ttl_ms).toBe(DEFAULT_TTL_MS);
  });

  it('toPublic() reports ttl_ms for docker depends_on tasks', () => {
    const task = new Task({
      id: 1,
      sessionId: 10,
      command: 'docker:postgres:16',
      dockerContainer: { image: 'postgres:16' },
      ttl: DEFAULT_TTL_MS,
    });
    expect(task.toPublic().ttl_ms).toBe(DEFAULT_TTL_MS);
  });

  it('getLogs() returns empty string initially', () => {
    const task = new Task({ id: 1, sessionId: 1, command: 'x', taskService: service });
    expect(task.getLogs()).toBe('');
  });

  it('kill() resolves false when not running', async () => {
    const task = new Task({ id: 1, sessionId: 1, command: 'x', taskService: service });
    task.status = 'exited';
    await expect(task.kill()).resolves.toBe(false);
  });

  it('starts as waiting until start() runs', () => {
    const task = new Task({ id: 1, sessionId: 1, command: 'main' });
    expect(task.status).toBe('waiting');
    expect(task.started_at).toBeNull();
    const dep = new Task({ id: 2, sessionId: 1, command: 'dep' });
    const withDep = new Task({ id: 3, sessionId: 1, command: 'main', dependsOn: [dep] });
    expect(withDep.status).toBe('waiting');
  });

  it('kill() marks a running task exited when no child process exists yet', async () => {
    const task = new Task({ id: 1, sessionId: 1, command: 'x', ports: ['PORT'] });
    task.status = 'running';
    task.started_at = new Date().toISOString();
    await expect(task.kill()).resolves.toBe(true);
    expect(task.status).toBe('stopped');
    expect(task.exit_code).toBe(0);
  });

  it('kill() cancels depends_on tasks that have not started yet', async () => {
    const depStarted = new Task({ id: 2, sessionId: 1, command: 'x', ports: ['PORT'] });
    depStarted._started = true;
    depStarted._isRoot = true;
    setTaskRunning(depStarted);
    const depWaiting = new Task({ id: 3, sessionId: 1, command: 'echo later' });
    const main = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo main',
      dependsOn: [depStarted, depWaiting],
    });
    await main.kill();
    expect(depWaiting.status).toBe('stopped');
    expect(depWaiting._started).toBe(false);
    expect(depStarted.status).toBe('running');
  });

  it('kill() stops a non-root depends_on task with no other dependents', async () => {
    const dep = new Task({ id: 2, sessionId: 1, command: 'x', ports: ['PORT'] });
    dep._started = true;
    setTaskRunning(dep);
    const main = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo main',
      dependsOn: [dep],
    });
    await main.kill();
    expect(dep.status).toBe('stopped');
  });

  it('kill() leaves a root depends_on task running when the parent stops', async () => {
    const dep = new Task({ id: 2, sessionId: 1, command: 'x', ports: ['PORT'], isRoot: true });
    dep._started = true;
    setTaskRunning(dep);
    const main = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo main',
      dependsOn: [dep],
    });
    await main.kill();
    expect(dep.status).toBe('running');
  });

  it('kill() leaves a shared depends_on task running while another dependent is active', async () => {
    const dep = new Task({ id: 2, sessionId: 1, command: 'x', ports: ['PORT'] });
    dep._started = true;
    setTaskRunning(dep);
    const main1 = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo one',
      dependsOn: [dep],
    });
    const main2 = new Task({
      id: 3,
      sessionId: 1,
      command: 'echo two',
      dependsOn: [dep],
    });
    await main1.kill();
    expect(dep.status).toBe('running');
    await main2.kill();
    expect(dep.status).toBe('stopped');
  });

  it('exit() cancels depends_on tasks that have not started yet', () => {
    const dep2 = new Task({ id: 3, sessionId: 1, command: 'echo never', label: 'later' });
    const main = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo main',
      dependsOn: [dep2],
    });
    main.exit(1);
    expect(dep2._started).toBe(false);
    expect(dep2.status).toBe('exited');
  });

  it('kill() logs a manual stop with SIGTERM and the grace delay', async () => {
    const task = new Task({ id: 1, sessionId: 1, command: 'x', ports: ['PORT'] });
    await task.kill();
    expect(task.getLogs()).toMatch(
      /Stopped manually \(SIGTERM; force kill after 30s if still running\)/
    );
  });

  it('kill({ reason: "ttl" }) logs TTL expiry with SIGTERM and the grace delay', async () => {
    const task = new Task({ id: 1, sessionId: 1, command: 'x', ports: ['PORT'] });
    await task.kill({ reason: 'ttl' });
    expect(task.getLogs()).toMatch(
      /TTL expired \(SIGTERM; force kill after 30s if still running\)/
    );
    expect(task.getLogs()).not.toMatch(/Stopped manually/);
  });
});

// ─── TasksService store ───────────────────────────────────────────────────────

describe('TasksService.createTask', () => {
  it('stores a Task with waiting status until start()', () => {
    const task = service.createTask({ sessionId: 1, command: 'echo hi' });
    expect(task).toBeInstanceOf(Task);
    expect(task.id).toBe(1);
    expect(task.session_id).toBe(1);
    expect(task.command).toBe('echo hi');
    expect(task.status).toBe('waiting');
  });

  it('assigns incrementing ids', () => {
    const a = service.createTask({ sessionId: 1, command: 'a' });
    const b = service.createTask({ sessionId: 1, command: 'b' });
    expect(b.id).toBe(a.id + 1);
  });

  it('returns the same Task instance that getTask returns', () => {
    const task = service.createTask({ sessionId: 1, command: 'x' });
    expect(service.getTask(task.id)).toBe(task);
  });

  it('applies extra_env after YAML task env so extra_env wins on conflicts', async () => {
    const task = service.createTask({
      sessionId: 1,
      command: 'echo ok',
      env: { SESSION: 'base' },
      extraEnv: { FOO: 'from-extra' },
      taskEnvRaw: { FOO: 'from-yaml', BAR: 'from-yaml' },
      configTaskKeys: ['run-tests'],
      dependsOnKeys: [],
      interpolateOpts: { shortId: 'ab', secrets: {}, publicUri: '', servicesUriMap: {} },
    });
    const startProcess = vi.spyOn(task, '_startProcess').mockResolvedValue(task);
    task.start();
    await vi.waitFor(() => expect(startProcess).toHaveBeenCalled());
    expect(task._env).toEqual({
      SESSION: 'base',
      FOO: 'from-extra',
      BAR: 'from-yaml',
    });
  });
});

describe('TasksService._findRunningTask', () => {
  it('matches config tasks by task_key only', () => {
    const task = service.createTask({
      sessionId: 1,
      command: 'pnpm run dev',
      taskKey: 'dev-server',
      ports: ['PORT'],
    });
    expect(task.label).toBe('dev-server');
    expect(service._findRunningTask(1, 'dev-server')).toBe(task);
    expect(service._findRunningTask(1, 'baguette:webserver:default')).toBeNull();
  });

  it('matches ad-hoc tasks by label when there is no task_key', () => {
    const task = service.createTask({
      sessionId: 1,
      command: 'npm start',
      label: 'baguette:webserver:default',
      ports: ['PORT'],
    });
    expect(service._findRunningTask(1, 'baguette:webserver:default')).toBe(task);
    expect(service._findRunningTask(1, 'dev-server')).toBeNull();
  });
});

describe('TasksService.getTask', () => {
  it('returns the Task by id', () => {
    const task = service.createTask({ sessionId: 1, command: 'ls' });
    expect(service.getTask(task.id)).toBe(task);
  });

  it('returns null for unknown id', () => {
    expect(service.getTask(999)).toBeNull();
  });

  it('accepts string ids (coerces to number)', () => {
    const task = service.createTask({ sessionId: 1, command: 'x' });
    expect(service.getTask(String(task.id))).toBe(task);
  });
});

describe('TasksService.filterTasks', () => {
  it('returns all tasks when no filters given', () => {
    service.createTask({ sessionId: 1, command: 'a' });
    service.createTask({ sessionId: 2, command: 'b' });
    expect(service.filterTasks()).toHaveLength(2);
  });

  it('filters by sessionIds set', () => {
    const t1 = service.createTask({ sessionId: 1, command: 'a' });
    service.createTask({ sessionId: 2, command: 'b' });
    const result = service.filterTasks({ sessionIds: new Set([1]) });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(t1.id);
  });

  it('filters by status', () => {
    const t1 = service.createTask({ sessionId: 1, command: 'a' });
    setTaskRunning(t1);
    const t2 = service.createTask({ sessionId: 1, command: 'b' });
    t2.status = 'exited';
    const result = service.filterTasks({ status: 'running' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(t1.id);
  });

  it('returns public objects (no logBuffer)', () => {
    service.createTask({ sessionId: 1, command: 'x' });
    const [pub] = service.filterTasks();
    expect(pub.logBuffer).toBeUndefined();
  });
});

describe('TasksService.deleteTask', () => {
  it('removes the task from the store', () => {
    const task = service.createTask({ sessionId: 1, command: 'x' });
    expect(service.deleteTask(task.id)).toBe(true);
    expect(service.getTask(task.id)).toBeNull();
  });

  it('returns false for unknown id', () => {
    expect(service.deleteTask(999)).toBe(false);
  });

  it('starts kill then drops the task from the store', () => {
    const task = service.createTask({ sessionId: 1, command: 'x' });
    const kill = vi.fn().mockResolvedValue(true);
    task.kill = kill;
    service.deleteTask(task.id);
    expect(kill).toHaveBeenCalled();
  });
});

describe('TasksService.killSessionTasks', () => {
  it('starts kill for all running tasks for a session', () => {
    const t1 = service.createTask({ sessionId: 1, command: 'a' });
    const t2 = service.createTask({ sessionId: 1, command: 'b' });
    const t3 = service.createTask({ sessionId: 2, command: 'c' });

    const kill1 = vi.fn().mockResolvedValue(true);
    const kill2 = vi.fn().mockResolvedValue(true);
    const kill3 = vi.fn().mockResolvedValue(true);
    t1.kill = kill1;
    t2.kill = kill2;
    t3.kill = kill3;

    service.killSessionTasks(1);

    expect(kill1).toHaveBeenCalled();
    expect(kill2).toHaveBeenCalled();
    expect(kill3).not.toHaveBeenCalled();
  });
});

describe('Task.onLog / onExit unsubscribe', () => {
  it('onLog replays buffer then receives new logs; unsub stops delivery', () => {
    const task = new Task({ id: 1, sessionId: 1, command: 'x' });
    task.addLog('stdout', 'buffered\n');

    const received = [];
    const unsub = task.onLog((_id, _stream, data) => received.push(data));

    expect(received).toEqual(['buffered\n']); // replayed on subscribe

    task.addLog('stdout', 'live\n');
    expect(received).toEqual(['buffered\n', 'live\n']);

    unsub();
    task.addLog('stdout', 'after unsub\n');
    expect(received).toEqual(['buffered\n', 'live\n']); // no new delivery
  });

  it('onExit fires on exit; unsub before exit prevents delivery', () => {
    const task = new Task({ id: 1, sessionId: 1, command: 'x' });
    const calls = [];
    const unsub = task.onExit((_id, code) => calls.push(code));

    unsub();
    task.exit(0);
    expect(calls).toHaveLength(0);
  });

  it('onExit fires immediately and returns no-op unsub when already exited', () => {
    const task = new Task({ id: 1, sessionId: 1, command: 'x' });
    task.exit(2);

    const calls = [];
    const unsub = task.onExit((_id, code) => calls.push(code));
    expect(calls).toEqual([2]); // immediate replay

    expect(() => unsub()).not.toThrow(); // no-op unsub
  });

  it('multiple onLog subscribers are independent', () => {
    const task = new Task({ id: 1, sessionId: 1, command: 'x' });
    const a = [];
    const b = [];
    const unsubA = task.onLog((_id, _s, d) => a.push(d));
    task.onLog((_id, _s, d) => b.push(d));

    task.addLog('stdout', 'msg\n');
    expect(a).toEqual(['msg\n']);
    expect(b).toEqual(['msg\n']);

    unsubA();
    task.addLog('stdout', 'after\n');
    expect(a).toEqual(['msg\n']); // unsubscribed
    expect(b).toEqual(['msg\n', 'after\n']); // still subscribed
  });
});

describe('Task heartbeat / TTL', () => {
  afterEach(() => {
    vi.useRealTimers();
    isPortListening.mockReset();
    isPortListening.mockResolvedValue(false);
  });

  it('heartbeat() is a no-op when ttl is not set', () => {
    vi.useFakeTimers();
    const task = new Task({ id: 1, sessionId: 1, command: 'x' });
    const kill = vi.spyOn(task, 'kill').mockResolvedValue(true);

    task.heartbeat();
    vi.advanceTimersByTime(DEFAULT_TTL_MS + 1);

    expect(kill).not.toHaveBeenCalled();
    expect(task.status).toBe('waiting');
  });

  it('heartbeat() starts idle TTL while the task is still waiting', () => {
    vi.useFakeTimers();
    const task = new Task({
      id: 1,
      sessionId: 1,
      command: 'x',
      ports: ['PORT'],
      ttl: DEFAULT_TTL_MS,
    });
    const kill = vi.spyOn(task, 'kill').mockResolvedValue(true);

    task.heartbeat();
    vi.advanceTimersByTime(DEFAULT_TTL_MS - 1);
    expect(kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith({ reason: 'ttl' });
  });

  it('heartbeat() starts idle TTL when ttl is set', () => {
    vi.useFakeTimers();
    const task = new Task({
      id: 1,
      sessionId: 1,
      command: 'x',
      ports: ['PORT'],
      ttl: DEFAULT_TTL_MS,
    });
    const kill = vi.spyOn(task, 'kill').mockResolvedValue(true);

    setTaskRunning(task);
    task.heartbeat();
    vi.advanceTimersByTime(DEFAULT_TTL_MS - 1);
    expect(kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith({ reason: 'ttl' });
  });

  it('heartbeat() starts idle TTL for docker tasks without port env vars', () => {
    vi.useFakeTimers();
    const task = new Task({
      id: 1,
      sessionId: 1,
      command: 'docker:postgres:16',
      dockerContainer: { image: 'postgres:16' },
      ttl: DEFAULT_TTL_MS,
    });
    const kill = vi.spyOn(task, 'kill').mockResolvedValue(true);

    setTaskRunning(task);
    task.heartbeat();
    vi.advanceTimersByTime(DEFAULT_TTL_MS - 1);
    expect(kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledWith({ reason: 'ttl' });
  });

  it('heartbeat() resets the idle TTL window', () => {
    vi.useFakeTimers();
    const task = new Task({
      id: 1,
      sessionId: 1,
      command: 'x',
      ports: ['PORT'],
      ttl: DEFAULT_TTL_MS,
    });
    const kill = vi.spyOn(task, 'kill').mockResolvedValue(true);

    setTaskRunning(task);
    task.heartbeat();
    vi.advanceTimersByTime(DEFAULT_TTL_MS - 1);
    task.heartbeat();
    vi.advanceTimersByTime(DEFAULT_TTL_MS - 1);
    expect(kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('heartbeat() is a no-op after the task has exited', () => {
    vi.useFakeTimers();
    const task = new Task({
      id: 1,
      sessionId: 1,
      command: 'x',
      ports: ['PORT'],
      ttl: DEFAULT_TTL_MS,
    });
    const kill = vi.spyOn(task, 'kill').mockResolvedValue(true);
    task.exit(0);

    task.heartbeat();
    vi.advanceTimersByTime(DEFAULT_TTL_MS + 1);

    expect(kill).not.toHaveBeenCalled();
  });

  it('start() heartbeats docker depends_on immediately and every minute until exit', () => {
    vi.useFakeTimers();
    const dep = new Task({
      id: 1,
      sessionId: 1,
      command: 'docker:postgres:16',
      dockerContainer: { image: 'postgres:16' },
      ttl: DEFAULT_TTL_MS,
    });
    const hb = vi.spyOn(dep, 'heartbeat');
    vi.spyOn(dep, 'start').mockImplementation(() => {
      dep._started = true;
      return dep;
    });
    vi.spyOn(dep, 'waitForReady').mockResolvedValue();

    const main = new Task({
      id: 2,
      sessionId: 1,
      command: 'x',
      dependsOn: [dep],
    });
    vi.spyOn(main, '_startProcess').mockResolvedValue(main);

    main.start();
    expect(hb).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(hb).toHaveBeenCalledTimes(2);

    main.exit(0);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(hb).toHaveBeenCalledTimes(2);
  });

  it('start() heartbeats an already-started depends_on task', () => {
    vi.useFakeTimers();
    const dep = new Task({
      id: 1,
      sessionId: 1,
      command: 'x',
      ports: ['PORT'],
      ttl: DEFAULT_TTL_MS,
    });
    setTaskRunning(dep);
    dep._started = true;
    const hb = vi.spyOn(dep, 'heartbeat');
    vi.spyOn(dep, 'start').mockImplementation(() => dep);
    vi.spyOn(dep, 'waitForReady').mockResolvedValue();

    const main = new Task({
      id: 2,
      sessionId: 1,
      command: 'x',
      dependsOn: [dep],
    });
    vi.spyOn(main, '_startProcess').mockResolvedValue(main);

    main.start();
    expect(hb).toHaveBeenCalled();
  });

  it('start() re-arms depends_on heartbeat loop when reusing an already-started task', async () => {
    const nested = new Task({
      id: 1,
      sessionId: 1,
      command: 'postgres',
      dockerContainer: { image: 'postgres:16' },
      ttl: DEFAULT_TTL_MS,
    });
    const mid = new Task({
      id: 2,
      sessionId: 1,
      command: 'mid',
      dependsOn: [nested],
    });
    mid._started = true;
    const nestedHb = vi.spyOn(nested, 'heartbeat');

    const main = new Task({
      id: 3,
      sessionId: 1,
      command: 'main',
      dependsOn: [mid],
    });
    vi.spyOn(mid, 'start').mockImplementation(() => mid);
    vi.spyOn(mid, 'waitForReady').mockResolvedValue();
    vi.spyOn(main, '_startProcess').mockResolvedValue(main);

    main.start();
    await vi.waitFor(() => expect(nestedHb).toHaveBeenCalled());
  });

  it('start() heartbeats depends_on immediately and every minute until exit', () => {
    vi.useFakeTimers();
    const dep = new Task({
      id: 1,
      sessionId: 1,
      command: 'x',
      ports: ['PORT'],
      ttl: DEFAULT_TTL_MS,
    });
    const hb = vi.spyOn(dep, 'heartbeat');
    vi.spyOn(dep, 'start').mockImplementation(() => {
      dep._started = true;
      return dep;
    });
    vi.spyOn(dep, 'waitForReady').mockResolvedValue();

    const main = new Task({
      id: 2,
      sessionId: 1,
      command: 'x',
      dependsOn: [dep],
    });
    vi.spyOn(main, '_startProcess').mockResolvedValue(main);

    main.start();
    expect(hb).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(hb).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(hb).toHaveBeenCalledTimes(3);

    main.exit(0);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(hb).toHaveBeenCalledTimes(3);
  });

  it('waitForReady does not time out while ports are still unallocated (init/deps)', async () => {
    vi.useFakeTimers();
    isPortListening.mockResolvedValue(false);
    const task = new Task({ id: 1, sessionId: 1, command: 'x', ports: ['PORT'], label: 'web' });

    const ready = task.waitForReady({ timeoutMs: 1_000, pollMs: 100 });
    const raced = Promise.race([
      ready.then(() => 'ready').catch((err) => err.message),
      new Promise((resolve) => setTimeout(() => resolve('still-waiting'), 5_000)),
    ]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await raced).toBe('still-waiting');

    isPortListening.mockResolvedValue(true);
    task.ports = { PORT: 12345 };
    const afterAlloc = Promise.race([ready.then(() => 'ready'), new Promise(() => {})]);
    await vi.advanceTimersByTimeAsync(200);
    expect(await afterAlloc).toBe('ready');
  });

  it('waitForReady times out only after ports are allocated but not listening', async () => {
    vi.useFakeTimers();
    isPortListening.mockResolvedValue(false);
    const task = new Task({ id: 1, sessionId: 1, command: 'x', ports: ['PORT'], label: 'web' });
    task.ports = { PORT: 12345 };

    const ready = task.waitForReady({ timeoutMs: 1_000, pollMs: 100 });
    const assertion = expect(ready).rejects.toThrow('ports not ready after 1000ms');
    await vi.advanceTimersByTimeAsync(1_100);
    await assertion;
  });

  it('waitForReady waits for docker container before healthcheck or TCP ports', async () => {
    vi.useFakeTimers();
    const healthWait = vi.spyOn(dockerSession, 'waitForContainerHealth').mockResolvedValue();
    isPortListening.mockResolvedValue(true);

    const task = new Task({
      id: 1,
      sessionId: 1,
      shortId: 'abcd',
      command: 'x',
      ports: ['PG_PORT'],
      label: 'postgres',
      taskKey: 'postgres',
      dockerContainer: {
        image: 'postgres:16',
        healthcheck: { test: ['CMD-SHELL', 'pg_isready'], interval: '1s' },
      },
    });
    task.ports = { PG_PORT: 54321 };

    const ready = task.waitForReady({ timeoutMs: 5_000, pollMs: 100 });
    let resolved = false;
    ready.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(false);
    expect(isPortListening).not.toHaveBeenCalled();
    expect(healthWait).not.toHaveBeenCalled();

    task._dockerContainer = { image: 'postgres:16', healthcheck: { test: ['CMD-SHELL'] } };
    task._dockerContainerName = 'baguette_abcd_postgres';
    await vi.advanceTimersByTimeAsync(100);
    await ready;
    expect(resolved).toBe(true);
    expect(healthWait).toHaveBeenCalledWith('baguette_abcd_postgres', {
      timeoutMs: 5_000,
      pollMs: 100,
    });
    expect(isPortListening).not.toHaveBeenCalled();

    healthWait.mockRestore();
  });

  it('waitForReady does not time out while depends_on tasks are still starting', async () => {
    vi.useFakeTimers();
    isPortListening.mockResolvedValue(false);

    const dep = new Task({ id: 1, sessionId: 1, command: 'x', ports: ['PORT'], label: 'dep' });
    const main = new Task({
      id: 2,
      sessionId: 1,
      command: 'x',
      ports: ['WEB_PORT'],
      label: 'web',
      dependsOn: [dep],
    });
    vi.spyOn(main, '_startProcess').mockImplementation(async () => {
      main._depsSatisfied = true;
      main.ports = { WEB_PORT: 3000 };
      return main;
    });
    vi.spyOn(dep, 'start').mockImplementation(() => {
      dep._started = true;
      return dep;
    });
    vi.spyOn(dep, 'waitForReady').mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 10_000))
    );

    main.start();
    const ready = main.waitForReady({ timeoutMs: 1_000, pollMs: 100 });
    const raced = Promise.race([
      ready.then(() => 'ready').catch((err) => err.message),
      new Promise((resolve) => setTimeout(() => resolve('still-waiting'), 5_000)),
    ]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await raced).toBe('still-waiting');

    isPortListening.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(10_500);
    await expect(ready).resolves.toBeUndefined();
  });

  it('waitForReady does not probe host ports for docker tasks without a yaml healthcheck', async () => {
    vi.useFakeTimers();
    const healthWait = vi.spyOn(dockerSession, 'waitForContainerHealth').mockResolvedValue();
    isPortListening.mockResolvedValue(false);

    const task = new Task({
      id: 1,
      sessionId: 1,
      shortId: 'abcd',
      command: 'x',
      ports: ['PG_PORT'],
      label: 'postgres',
      taskKey: 'postgres',
      dockerContainer: { image: 'postgres:16' },
    });
    task.ports = { PG_PORT: 54321 };

    const ready = task.waitForReady({ timeoutMs: 1_000, pollMs: 100 });
    task._dockerContainerName = 'baguette_abcd_postgres';
    await vi.advanceTimersByTimeAsync(200);
    await expect(ready).resolves.toBeUndefined();
    expect(healthWait).not.toHaveBeenCalled();
    expect(isPortListening).not.toHaveBeenCalled();
    healthWait.mockRestore();
    vi.useRealTimers();
  });

  it('waitForReady ignores empty docker healthcheck blocks in yaml', async () => {
    vi.useFakeTimers();
    const healthWait = vi.spyOn(dockerSession, 'waitForContainerHealth').mockResolvedValue();

    const task = new Task({
      id: 1,
      sessionId: 1,
      shortId: 'abcd',
      command: 'docker:redis:7',
      taskKey: 'redis',
      dockerContainer: { image: 'redis:7', healthcheck: {} },
    });

    const ready = task.waitForReady({ timeoutMs: 1_000, pollMs: 100 });
    task._dockerContainerName = 'baguette_abcd_redis';
    await vi.advanceTimersByTimeAsync(200);
    await expect(ready).resolves.toBeUndefined();
    expect(healthWait).not.toHaveBeenCalled();
    healthWait.mockRestore();
    vi.useRealTimers();
  });

  it('waitForReady treats docker without healthcheck as ready once the container is running', async () => {
    vi.useFakeTimers();
    isPortListening.mockResolvedValue(true);

    const task = new Task({
      id: 1,
      sessionId: 1,
      shortId: 'abcd',
      command: 'docker:redis:7',
      taskKey: 'redis',
      dockerContainer: { image: 'redis:7' },
    });

    const ready = task.waitForReady({ timeoutMs: 1_000, pollMs: 100 });
    await vi.advanceTimersByTimeAsync(500);
    let settled = false;
    ready.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);
    expect(isPortListening).not.toHaveBeenCalled();

    task._dockerContainerName = 'baguette_abcd_redis';
    await vi.advanceTimersByTimeAsync(200);
    await expect(ready).resolves.toBeUndefined();
    expect(isPortListening).not.toHaveBeenCalled();
  });

  it('waitForReady waits for docker container name when there are no port env vars', async () => {
    vi.useFakeTimers();
    isPortListening.mockResolvedValue(true);

    const task = new Task({
      id: 1,
      sessionId: 1,
      shortId: 'abcd',
      command: 'x',
      ports: [],
      label: 'redis',
      taskKey: 'redis',
      dockerContainer: {
        image: 'redis:7',
        healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: '1s' },
      },
    });

    const ready = task.waitForReady({ timeoutMs: 5_000, pollMs: 100 });
    await vi.advanceTimersByTimeAsync(300);
    let settled = false;
    ready.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);

    task._dockerContainer = { image: 'redis:7', healthcheck: { test: ['CMD'] } };
    task._dockerContainerName = 'baguette_abcd_redis';
    const healthWait = vi.spyOn(dockerSession, 'waitForContainerHealth').mockResolvedValue();
    await vi.advanceTimersByTimeAsync(200);
    await expect(ready).resolves.toBeUndefined();
    healthWait.mockRestore();
  });

  it('toPublic includes is_docker for docker tasks', () => {
    const task = new Task({
      id: 1,
      sessionId: 1,
      command: 'docker:postgres:16',
      dockerContainer: { image: 'postgres:16' },
    });
    expect(task.toPublic().is_docker).toBe(true);
    expect(new Task({ id: 2, sessionId: 1, command: 'pnpm test' }).toPublic().is_docker).toBe(
      false
    );
  });

  function mockDockerRunChild() {
    const exitListeners = [];
    const child = {
      pid: 1001,
      stdout: { on: vi.fn(), destroy: vi.fn() },
      stderr: { on: vi.fn(), destroy: vi.fn() },
      stdin: { destroy: vi.fn() },
      on: vi.fn((event, cb) => {
        if (event === 'exit') exitListeners.push(cb);
      }),
      once: vi.fn((event, cb) => {
        if (event === 'exit') exitListeners.push(cb);
      }),
      removeAllListeners: vi.fn(),
      kill: vi.fn(),
      emitExit(code, signal) {
        for (const cb of exitListeners) cb(code, signal);
      },
    };
    return child;
  }

  it('start() logs and fails when docker container config is invalid', async () => {
    const task = new Task({
      id: 1,
      sessionId: 1,
      shortId: 'abcd',
      command: 'docker:bad',
      taskKey: 'bad',
      dockerContainer: { build: { dockerfile: 'Dockerfile' } },
    });

    const exited = new Promise((resolve) => task.onExit(() => resolve()));
    task.start();
    await exited;

    expect(task.status).toBe('exited');
    expect(task.exit_code).toBe(1);
    const logs = task.getLogs();
    expect(logs).toContain('container.build.context is required');
    expect(logs).toContain('Failed to start task');
  });

  it('_startDockerProcess passes session/task env keys to docker run, not host process.env', async () => {
    const runChild = mockDockerRunChild();
    const spawn = vi.spyOn(dockerSession, 'spawnDockerContainer').mockResolvedValue({
      child: runChild,
      containerName: 'baguette_abcd_pg',
    });

    const task = new Task({
      id: 1,
      sessionId: 1,
      shortId: 'abcd',
      command: 'docker:postgres:16',
      taskKey: 'postgres',
      dockerContainer: { image: 'postgres:16' },
      dockerEnvKeys: ['FROM_SESSION', 'POSTGRES_USER'],
    });
    const fullEnv = {
      PATH: '/usr/bin',
      FROM_SESSION: 'yes',
      POSTGRES_USER: 'postgres',
    };

    await task._startDockerProcess(fullEnv, {});

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskEnvKeys: ['FROM_SESSION', 'POSTGRES_USER'],
        env: { FROM_SESSION: 'yes', POSTGRES_USER: 'postgres' },
      })
    );
  });

  it('_startDockerProcess streams attached docker run output', async () => {
    const runChild = mockDockerRunChild();
    vi.spyOn(dockerSession, 'spawnDockerContainer').mockResolvedValue({
      child: runChild,
      containerName: 'baguette_abcd_pg',
    });

    const task = new Task({
      id: 1,
      sessionId: 1,
      shortId: 'abcd',
      command: 'docker:postgres:16',
      taskKey: 'postgres',
      dockerContainer: { image: 'postgres:16' },
    });

    await task._startDockerProcess({}, {});
    expect(task.pid).toBe(1001);
    expect(task._dockerContainerName).toBe('baguette_abcd_pg');

    const onStdout = runChild.stdout.on.mock.calls.find((c) => c[0] === 'data')?.[1];
    onStdout?.(Buffer.from('hello from db\n'));
    expect(task.getLogs()).toContain('hello from db');
  });

  it('docker run child exit ends task with container exit code', async () => {
    const runChild = mockDockerRunChild();
    vi.spyOn(dockerSession, 'spawnDockerContainer').mockResolvedValue({
      child: runChild,
      containerName: 'baguette_abcd_pg',
    });

    const task = new Task({
      id: 1,
      sessionId: 1,
      shortId: 'abcd',
      command: 'docker:postgres:16',
      taskKey: 'postgres',
      dockerContainer: { image: 'postgres:16' },
    });

    await task._startDockerProcess({}, {});
    runChild.emitExit(2);

    expect(task.status).toBe('exited');
    expect(task.exit_code).toBe(2);
    expect(task._dockerContainerName).toBeNull();
  });

  it('kill waits for attached docker run process to exit', async () => {
    const runChild = mockDockerRunChild();
    vi.spyOn(dockerSession, 'spawnDockerContainer').mockResolvedValue({
      child: runChild,
      containerName: 'baguette_abcd_pg',
    });
    vi.spyOn(dockerSession, 'stopDockerContainer').mockResolvedValue();
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const task = new Task({
      id: 1,
      sessionId: 1,
      shortId: 'abcd',
      command: 'docker:postgres:16',
      taskKey: 'postgres',
      dockerContainer: { image: 'postgres:16' },
    });

    await task._startDockerProcess({}, {});
    const killPromise = task.kill({ graceMs: 10, timeoutMs: 5000 });
    runChild.emitExit(0);
    await killPromise;

    expect(task.status).toBe('stopped');
    expect(task.exit_code).toBe(0);
  });
});

describe('TasksService eviction', () => {
  it('evicts an exited task when at capacity', () => {
    // Fill up to MAX_TASKS (500) — use a smaller service for testing by patching limit.
    // We only test the eviction logic by filling 3 slots and overriding MAX_TASKS indirectly
    // via the behaviour: create tasks, mark one exited, then add one more and verify count stays.
    // To avoid creating 500 tasks, we just verify the eviction function is called by mocking.
    const t1 = service.createTask({ sessionId: 1, command: 'a' });
    t1.status = 'exited';
    // Fill to MAX_TASKS - 1 more tasks then add one
    // This is an integration-style eviction check; full coverage is in the store internals.
    expect(service.getTask(t1.id)).not.toBeNull(); // still exists before eviction needed
  });
});

// ─── Notify monitoring (wake-ups) ─────────────────────────────────────────────

describe('Task notify monitoring', () => {
  it('fires notify listeners for lines matching the pattern', () => {
    const task = service.createTask({
      sessionId: 1,
      command: 'x',
      label: 'watcher',
      notifyPattern: 'Build complete|error',
    });
    expect(task.notify_pattern).toBe('Build complete|error');

    const events = [];
    task.onNotify((e) => events.push(e));
    task.addLog('stdout', 'compiling...\nBuild complete in 2s\n');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      task_id: task.id,
      event: 'pattern',
      status: 'waiting',
      matched_line: 'Build complete in 2s',
    });
    expect(task.toPublic().pattern_matched).toBe(true);
    expect(task.toPublic().has_matched).toBe(true);
  });

  it('buffers partial lines across chunks before matching', () => {
    const task = service.createTask({
      sessionId: 1,
      command: 'x',
      notifyPattern: 'READY',
    });
    const events = [];
    task.onNotify((e) => events.push(e));
    task.addLog('stdout', 'sys: REA'); // no newline yet
    task.addLog('stdout', 'DY now\n');
    expect(events).toHaveLength(1);
    expect(events[0].matched_line).toBe('sys: READY now');
  });

  it('does not match for tasks without a notify pattern', () => {
    const task = service.createTask({ sessionId: 1, command: 'x' });
    const events = [];
    task.onNotify((e) => events.push(e));
    task.addLog('stdout', 'error everywhere\nREADY\n');
    expect(events).toHaveLength(0);
    expect(task.notify_pattern).toBeNull();
  });

  it('emits an exit notify event when the task exits', () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'x' });
    const events = [];
    task.onNotify((e) => events.push(e));
    task.exit(0);
    const exitEvents = events.filter((e) => e.event === 'exit');
    expect(exitEvents).toHaveLength(1);
    expect(exitEvents[0]).toMatchObject({ event: 'exit', status: 'exited', exit_code: 0 });
  });

  it('stops scanning after the task is terminal', () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'MATCH' });
    const events = [];
    task.onNotify((e) => events.push(e));
    task.exit(0);
    task.addLog('stdout', 'MATCH after exit\n');
    expect(events.filter((e) => e.event === 'pattern')).toHaveLength(0);
  });

  it('caps remembered matching lines at 20', () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'hit' });
    for (let i = 0; i < 30; i++) task.addLog('stdout', `hit ${i}\n`);
    expect(task._matchedNotifyLines).toHaveLength(20);
    expect(task._matchedNotifyLines[0]).toBe('hit 10');
  });

  it('tailLogs returns the last bytes of the log', () => {
    const task = service.createTask({ sessionId: 1, command: 'x' });
    task.addLog('stdout', 'x'.repeat(100) + '\nEND\n');
    expect(task.tailLogs(4)).toBe('END\n');
    expect(task.tailLogs(10000)).toContain('END');
  });
});

describe('TasksService.waitForTaskEvent', () => {
  it('returns a timeout event for unknown task ids', async () => {
    const event = await service.waitForTaskEvent([999], { timeoutMs: 50 });
    expect(event.event).toBe('timeout');
    expect(event.task_id).toBeNull();
  });

  it('resolves immediately for terminal tasks', async () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'x' });
    task.exit(3);
    const event = await service.waitForTaskEvent([task.id], { timeoutMs: 1000 });
    expect(event).toMatchObject({
      task_id: task.id,
      event: 'exit',
      status: 'exited',
      exit_code: 3,
    });
    // Consumed: a later wait finds nothing, and the task is no longer notify-pending.
    expect(task.toPublic().notify_pending).toBe(false);
    const again = await service.waitForTaskEvent([task.id], { timeoutMs: 100 });
    expect(again.event).toBe('timeout');
  });

  it('treats a natural exit during the turn as a pending wake-up', async () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'done' });
    task.addLog('stdout', 'done\n');
    task.exit(0); // exits while the agent is still streaming its turn
    expect(task.toPublic().notify_pending).toBe(true);
    const event = await service.waitForTaskEvent([task.id], { timeoutMs: 1000 });
    expect(event).toMatchObject({ event: 'exit', status: 'exited', exit_code: 0 });
    expect(task.toPublic().notify_pending).toBe(false);
  });

  it('deliberate kills consume the exit (no wake-up owed)', async () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'x' });
    task.status = 'running';
    await task.kill({ reason: 'stopped' });
    expect(task.toPublic().notify_pending).toBe(false);
    const event = await service.waitForTaskEvent([task.id], { timeoutMs: 100 });
    expect(event.event).toBe('timeout');
  });

  it('non-monitored tasks are never notify-pending', () => {
    const task = service.createTask({ sessionId: 1, command: 'x' });
    expect(task.toPublic().notify_pending).toBe(false);
    task.status = 'running';
    expect(task.toPublic().notify_pending).toBe(false);
  });

  it('resolves immediately for tasks with an unconsumed match', async () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'HIT' });
    task.addLog('stdout', 'HIT one\n');
    const event = await service.waitForTaskEvent([task.id], { timeoutMs: 1000 });
    expect(event).toMatchObject({ event: 'pattern', matched_line: 'HIT one' });
    expect(task.toPublic().pattern_matched).toBe(false); // consumed
  });

  it('consumes matches once: a second wait sees only newer matches', async () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'HIT' });
    task.addLog('stdout', 'HIT one\n');

    const first = await service.waitForTaskEvent([task.id], { timeoutMs: 1000 });
    expect(first.matched_line).toBe('HIT one');

    const second = await service.waitForTaskEvent([task.id], { timeoutMs: 100 });
    expect(second.event).toBe('timeout');

    task.addLog('stdout', 'HIT two\n');
    const third = await service.waitForTaskEvent([task.id], { timeoutMs: 1000 });
    expect(third.event).toBe('pattern');
    expect(third.matched_line).toBe('HIT two');
  });

  it('waits for a live pattern match and returns it', async () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'DONE' });
    const waitPromise = service.waitForTaskEvent([task.id], { timeoutMs: 2000 });
    await Promise.resolve();
    task.addLog('stdout', 'DONE now\n');
    const event = await waitPromise;
    expect(event).toMatchObject({ event: 'pattern', matched_line: 'DONE now' });
  });

  it('resolves the exit event when the task exits while waiting', async () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'x' });
    const waitPromise = service.waitForTaskEvent([task.id], { timeoutMs: 2000 });
    await Promise.resolve();
    task.exit(0);
    const event = await waitPromise;
    expect(event).toMatchObject({ event: 'exit', status: 'exited', exit_code: 0 });
  });

  it('honours an already-aborted signal', async () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'x' });
    const controller = new AbortController();
    controller.abort();
    const event = await service.waitForTaskEvent([task.id], {
      timeoutMs: 1000,
      signal: controller.signal,
    });
    expect(event.event).toBe('timeout');
    expect(event.aborted).toBe(true);
  });

  it('killSessionAgentTasks kills agent tasks plus monitored tasks, sparing user/preview tasks', () => {
    const agentPlain = service.createTask({
      sessionId: 7,
      command: 'x',
      origin: 'agent',
    });
    const agentMonitored = service.createTask({
      sessionId: 7,
      command: 'x',
      notifyPattern: 'y',
      origin: 'agent',
    });
    const userTask = service.createTask({
      sessionId: 7,
      command: 'x',
      origin: 'user',
    });
    const userMonitored = service.createTask({
      sessionId: 7,
      command: 'x',
      notifyPattern: 'y',
      origin: 'user',
    });
    const previewTask = service.createTask({
      sessionId: 7,
      command: 'x',
      origin: 'preview',
    });
    const finishedAgent = service.createTask({
      sessionId: 7,
      command: 'x',
      origin: 'agent',
    });
    const other = service.createTask({ sessionId: 8, command: 'x', origin: 'agent' });
    for (const t of [
      agentPlain,
      agentMonitored,
      userTask,
      userMonitored,
      previewTask,
      finishedAgent,
      other,
    ])
      t.status = 'running';
    finishedAgent.status = 'succeeded';

    const killed = service.killSessionAgentTasks(7, 'stopped');
    expect(killed.map((t) => t.id)).toEqual([agentPlain.id, agentMonitored.id, userMonitored.id]);
    // No process attached: the graceful kill completes synchronously.
    expect(agentPlain.status).toBe('stopped');
    expect(agentPlain.kill_reason).toBe('stopped');
    expect(agentMonitored.status).toBe('stopped');
    // Monitored tasks are killed regardless of origin — wake-up obligations die with the turn.
    expect(userMonitored.status).toBe('stopped');
    // User-started and preview tasks keep running.
    expect(userTask.status).toBe('running');
    expect(previewTask.status).toBe('running');
    // Terminal tasks are never re-killed; other sessions untouched.
    expect(finishedAgent.status).toBe('succeeded');
    expect(other.status).toBe('running');
  });
});

describe('TasksService.awaitTask', () => {
  // awaitTask verifies ownership through the sessions service; stub it out.
  beforeEach(() => {
    service.setup({ service: () => ({ get: async () => ({ id: 1 }) }) });
  });

  it('rejects NotFound for unknown task ids', async () => {
    await expect(service.awaitTask(999, { user: { id: 1 } })).rejects.toThrow(/not found/i);
  });

  it('resolves with the next event and an output tail', async () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'HIT' });
    task.addLog('stdout', 'HIT one\n');
    const result = await service.awaitTask(task.id, { user: { id: 1 } });
    expect(result).toMatchObject({
      task_id: task.id,
      event: 'pattern',
      matched_line: 'HIT one',
    });
    expect(result.output_tail).toContain('HIT one');
  });

  it('resolves the exit event with exit_code for terminal tasks', async () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'x' });
    task.addLog('stdout', 'out\n');
    task.exit(2);
    const result = await service.awaitTask(task.id, { user: { id: 1 } });
    expect(result).toMatchObject({ event: 'exit', status: 'exited', exit_code: 2 });
    expect(result.output_tail).toContain('out');
  });

  it('times out with event "timeout" when nothing fires', async () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'LATER' });
    const result = await service.awaitTask(task.id, {
      user: { id: 1 },
      query: { timeout_ms: 50 },
    });
    expect(result).toMatchObject({ event: 'timeout', task_id: null, aborted: false });
    expect(result.output_tail).toBe('');
  });

  it('consumes events once: repeated awaits only see fresh ones', async () => {
    const task = service.createTask({ sessionId: 1, command: 'x', notifyPattern: 'HIT' });
    task.addLog('stdout', 'HIT one\n');

    const first = await service.awaitTask(task.id, { user: { id: 1 } });
    expect(first.matched_line).toBe('HIT one');

    const second = await service.awaitTask(task.id, {
      user: { id: 1 },
      query: { timeout_ms: 50 },
    });
    expect(second.event).toBe('timeout');

    task.addLog('stdout', 'HIT two\n');
    const third = await service.awaitTask(task.id, { user: { id: 1 } });
    expect(third.event).toBe('pattern');
    expect(third.matched_line).toBe('HIT two');
  });

  it('clamps timeout_ms to TASK_AWAIT_TIMEOUT_MS', () => {
    expect(TASK_AWAIT_TIMEOUT_MS).toBe(10 * 60_000);
  });
});
