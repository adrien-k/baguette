/**
 * Integration tests for Task depends_on: sequential pre-requisite execution,
 * nested dep log exposure, failure propagation, and listener registration.
 *
 * Uses real child processes — no child_process mocking.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setTimeout as delay } from 'timers/promises';
import { Task } from '../task.js';

async function waitFor(pred, { timeoutMs = 8_000, intervalMs = 50, msg = '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await delay(intervalMs);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms. ${msg}`);
}

describe('Task depends_on (integration)', () => {
  const runningTasks = [];

  afterEach(async () => {
    await Promise.all(runningTasks.splice(0).map((t) => t.kill().catch(() => {})));
  });

  it('runs dep to completion before starting the main task', async () => {
    const dep = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo dep-output',
      label: 'dep',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    const main = new Task({
      id: 2,
      sessionId: 1,
      command: 'echo main-output',
      label: 'main',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
      dependsOn: [dep],
    });
    runningTasks.push(dep, main);

    await main.start();
    await waitFor(() => main.status === 'exited', { msg: 'main task did not exit' });

    expect(dep.status).toBe('exited');
    expect(dep.exit_code).toBe(0);
    expect(main.status).toBe('exited');
    expect(main.exit_code).toBe(0);
  });

  it('keeps dep output out of the parent log, but exposes it with includeNestedTasks', async () => {
    const dep = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo hello-from-dep',
      label: 'my-dep',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    const main = new Task({
      id: 2,
      sessionId: 1,
      command: 'echo hello-from-main',
      label: 'main',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
      dependsOn: [dep],
    });
    runningTasks.push(dep, main);

    await main.start();
    await waitFor(() => main.status === 'exited');

    const logs = main.getLogs();
    expect(logs).not.toContain('hello-from-dep');
    expect(logs).toContain('hello-from-main');
    expect(logs).toContain('my-dep'); // pre-requisite header includes label
    expect(logs).toContain(`task #${dep.id}`); // …and points at the dep's own task

    const nested = main.getLogs({ includeNestedTasks: true });
    expect(nested).toContain('hello-from-dep');
    expect(nested.indexOf('hello-from-dep')).toBeLessThan(nested.indexOf('hello-from-main'));
  });

  it('onLog({ includeNestedTasks: true }) replays and streams dep output', async () => {
    const dep = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo dep-line',
      label: 'my-dep',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    const main = new Task({
      id: 2,
      sessionId: 1,
      command: 'echo main-line',
      label: 'main',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
      dependsOn: [dep],
    });
    runningTasks.push(dep, main);

    const flat = [];
    const nested = [];
    main.onLog((_id, _stream, data) => flat.push(data));
    const unsub = main.onLog((_id, _stream, data) => nested.push(data), {
      includeNestedTasks: true,
    });

    await main.start();
    await waitFor(() => main.status === 'exited');
    await waitFor(() => nested.join('').includes('main-line'));

    expect(flat.join('')).not.toContain('dep-line');
    expect(nested.join('')).toContain('dep-line');
    // no duplicates: the dep line is delivered once, live, not again from the replay marker
    expect(nested.join('').match(/dep-line/g)).toHaveLength(1);

    unsub();
    main.addLog('stdout', 'after-unsub\n');
    dep.addLog('stdout', 'dep-after-unsub\n');
    expect(nested.join('')).not.toContain('after-unsub');
  });

  it('a late nested subscriber replays dep output that already happened', async () => {
    const dep = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo early-dep-line',
      label: 'my-dep',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    const main = new Task({
      id: 2,
      sessionId: 1,
      command: 'echo main-line',
      label: 'main',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
      dependsOn: [dep],
    });
    runningTasks.push(dep, main);

    await main.start();
    await waitFor(() => main.status === 'exited');

    const received = [];
    main.onLog((_id, _stream, data) => received.push(data), { includeNestedTasks: true });

    const joined = received.join('');
    expect(joined).toContain('early-dep-line');
    expect(joined.match(/early-dep-line/g)).toHaveLength(1);
    expect(joined.indexOf('early-dep-line')).toBeLessThan(joined.indexOf('main-line'));
  });

  it('fails the main task when a dep exits non-zero, without running the main process', async () => {
    const dep = new Task({
      id: 1,
      sessionId: 1,
      command: 'exit 2',
      label: 'failing-dep',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    const main = new Task({
      id: 2,
      sessionId: 1,
      command: 'echo should-not-run',
      label: 'main',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
      dependsOn: [dep],
    });
    runningTasks.push(dep, main);

    await main.start();
    await waitFor(() => main.status === 'exited');

    expect(dep.exit_code).toBe(2);
    expect(main.status).toBe('exited');
    expect(main.exit_code).toBe(2);
    expect(main.getLogs()).not.toContain('should-not-run');
    expect(main.getLogs()).toContain('Pre-requisite failed: failing-dep');
  });

  it('runs multiple deps sequentially and in order', async () => {
    const dep1 = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo step-one',
      label: 'dep1',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    const dep2 = new Task({
      id: 2,
      sessionId: 1,
      command: 'echo step-two',
      label: 'dep2',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    const main = new Task({
      id: 3,
      sessionId: 1,
      command: 'echo step-three',
      label: 'main',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
      dependsOn: [dep1, dep2],
    });
    runningTasks.push(dep1, dep2, main);

    await main.start();
    await waitFor(() => main.status === 'exited');

    expect(main.exit_code).toBe(0);
    const logs = main.getLogs({ includeNestedTasks: true });
    const i1 = logs.indexOf('step-one');
    const i2 = logs.indexOf('step-two');
    const i3 = logs.indexOf('step-three');
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });

  it('stops at the first failing dep and does not run later deps or main', async () => {
    const dep1 = new Task({
      id: 1,
      sessionId: 1,
      command: 'exit 1',
      label: 'failing-dep',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    const dep2 = new Task({
      id: 2,
      sessionId: 1,
      command: 'echo dep2-should-not-run',
      label: 'dep2',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    const main = new Task({
      id: 3,
      sessionId: 1,
      command: 'echo main-should-not-run',
      label: 'main',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
      dependsOn: [dep1, dep2],
    });
    runningTasks.push(dep1, dep2, main);

    await main.start();
    await waitFor(() => main.status === 'exited');

    expect(main.exit_code).toBe(1);
    expect(main.getLogs()).not.toContain('dep2-should-not-run');
    expect(main.getLogs()).not.toContain('main-should-not-run');
  });

  it('start() is idempotent — calling it twice does not spawn a second process', async () => {
    const task = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo once',
      label: 'test',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    runningTasks.push(task);

    await task.start();
    const pidAfterFirst = task.pid;

    await task.start(); // no-op

    expect(task.pid).toBe(pidAfterFirst); // same process, not a new one
    await waitFor(() => task.status === 'exited');
    expect(task.exit_code).toBe(0);
  });

  it('onLog() and onExit() methods register listeners that are called on process events', async () => {
    const logs = [];
    let exitedCode = null;

    const task = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo listener-test && exit 3',
      label: 'test',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    task.onLog((_id, _stream, data) => logs.push(data));
    task.onExit((_id, code) => {
      exitedCode = code;
    });
    runningTasks.push(task);

    await task.start();
    await waitFor(() => task.status === 'exited');

    expect(logs.join('')).toContain('listener-test');
    expect(exitedCode).toBe(3);
  });

  it('already-running dep in dependsOn: start() is a no-op on the dep, main still waits for it', async () => {
    // dep is a long-running process that we start independently before adding to main's dependsOn
    const dep = new Task({
      id: 1,
      sessionId: 1,
      command: 'sleep 0.2 && echo dep-done',
      label: 'already-running-dep',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    runningTasks.push(dep);
    await dep.start(); // dep is now running

    const main = new Task({
      id: 2,
      sessionId: 1,
      command: 'echo main-after-dep',
      label: 'main',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
      dependsOn: [dep],
    });
    runningTasks.push(main);

    await main.start();
    await waitFor(() => main.status === 'exited', {
      msg: 'main did not exit after already-running dep',
      timeoutMs: 5_000,
    });

    expect(dep.exit_code).toBe(0);
    expect(main.exit_code).toBe(0);
    // dep was already started — start() was a no-op, PID unchanged
    expect(dep._started).toBe(true);
  });

  it('already-succeeded dep in dependsOn: main runs immediately without re-running dep', async () => {
    const dep = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo dep-done',
      label: 'already-succeeded-dep',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    runningTasks.push(dep);
    await dep.start();
    await waitFor(() => dep.status === 'exited', { msg: 'dep did not exit' });
    expect(dep.exit_code).toBe(0);

    const main = new Task({
      id: 2,
      sessionId: 1,
      command: 'echo main-output',
      label: 'main',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
      dependsOn: [dep],
    });
    runningTasks.push(main);

    await main.start();
    await waitFor(() => main.status === 'exited', { msg: 'main did not exit after succeeded dep' });

    expect(main.exit_code).toBe(0);
    expect(main.getLogs()).toContain('main-output');
    expect(main.getLogs()).toContain('Pre-requisite completed');
  });

  it('already-failed dep in dependsOn: main fails immediately without running', async () => {
    const dep = new Task({
      id: 1,
      sessionId: 1,
      command: 'exit 3',
      label: 'already-failed-dep',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    runningTasks.push(dep);
    await dep.start();
    await waitFor(() => dep.status === 'exited', { msg: 'dep did not exit' });
    expect(dep.exit_code).toBe(3);

    const main = new Task({
      id: 2,
      sessionId: 1,
      command: 'echo should-not-run',
      label: 'main',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
      dependsOn: [dep],
    });
    runningTasks.push(main);

    await main.start();
    // main.fail() is synchronous so no need to wait
    await waitFor(() => main.status === 'exited', {
      msg: 'main did not fail after already-failed dep',
    });

    expect(main.status).toBe('exited');
    expect(main.exit_code).toBe(3);
    expect(main.pid).toBeNull(); // main process was never spawned
    expect(main.getLogs()).not.toContain('should-not-run');
  });

  it('multiple onLog() / onExit() listeners all fire', async () => {
    const calls = [];
    const task = new Task({
      id: 1,
      sessionId: 1,
      command: 'echo multi',
      label: 'test',
      taskService: null,
      env: process.env,
      cwd: '/tmp',
    });
    task.onLog(() => calls.push('log-a'));
    task.onLog(() => calls.push('log-b'));
    task.onExit(() => calls.push('exit-a'));
    task.onExit(() => calls.push('exit-b'));
    runningTasks.push(task);

    await task.start();
    await waitFor(() => task.status === 'exited');

    expect(calls).toContain('log-a');
    expect(calls).toContain('log-b');
    expect(calls).toContain('exit-a');
    expect(calls).toContain('exit-b');
  });
});
