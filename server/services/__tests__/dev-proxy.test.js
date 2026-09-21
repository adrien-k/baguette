import { describe, it, expect, vi } from 'vitest';
import { DevProxy } from '../dev-proxy.js';
import { Task } from '../task.js';

describe('DevProxy._releaseProxyState', () => {
  it('does not remove the task from the task store', () => {
    const deleteTask = vi.fn();
    const proxy = new DevProxy({ service: () => ({ deleteTask }) }, []);
    const task = new Task({ id: 7, sessionId: 1, command: 'echo', ports: ['PORT'] });
    task.exit(1);
    const unsubLog = vi.fn();
    const unsubExit = vi.fn();
    const state = { task, unsubLog, unsubExit, status: 'crashed' };
    const key = 'session-abc.example.com';

    proxy.states.set(key, state);
    proxy._releaseProxyState(key, state);

    expect(deleteTask).not.toHaveBeenCalled();
    expect(unsubLog).toHaveBeenCalled();
    expect(unsubExit).toHaveBeenCalled();
    expect(proxy.states.has(key)).toBe(false);
    expect(task.status).toBe('exited');
  });
});

/** Task stub: enough surface for attachWebserverTask / _wireTaskToProxy, exit driven by the test. */
function stubTask({ id = 1, logs = 'listening on 3000\n' } = {}) {
  const exitListeners = [];
  return {
    id,
    status: 'running',
    ports: { PORT: 3000 },
    kill_reason: null,
    getLogs: () => logs,
    onLog: () => () => {},
    onExit(fn) {
      exitListeners.push(fn);
      return () => {};
    },
    // Never resolves: the test drives the state through _onListening / exit instead.
    waitForReady: () => new Promise(() => {}),
    heartbeat: () => {},
    exit(code) {
      this.status = 'exited';
      for (const fn of exitListeners) fn(this.id, code);
    },
  };
}

/** Replayable SSE events buffered for a channel, decoded. */
function replayedEvents(proxy, key) {
  return (proxy.sse._eventLog.get(key) ?? []).map((msg) => JSON.parse(msg.slice('data: '.length)));
}

describe('DevProxy exit after the server came up', () => {
  const key = 'session-abc.example.com';

  it('keeps the state with logs and an error event when stopped from the Preview tab', () => {
    const proxy = new DevProxy({}, []);
    const task = stubTask();
    const state = proxy.attachWebserverTask(key, task, 'PORT');
    proxy._onListening(key, state, 3000);

    task.kill_reason = 'stopped';
    task.exit(1);

    expect(proxy.states.get(key)).toBe(state);
    expect(state.status).toBe('crashed'); // terminal → dispatch renders logs + Retry
    expect(state.port).toBe(null);
    const events = replayedEvents(proxy, key);
    // No `ready` left over, otherwise the loading page would reload in a loop.
    expect(events.some((e) => e.event === 'ready')).toBe(false);
    expect(events.filter((e) => e.event === 'log').map((e) => e.data)).toContain(
      'listening on 3000\n'
    );
    expect(events.at(-1)).toEqual({
      event: 'error',
      data: { message: 'Dev server was stopped.' },
    });
  });

  it('keeps the state and reports the exit code when the server crashes on its own', () => {
    const proxy = new DevProxy({}, []);
    const task = stubTask();
    const state = proxy.attachWebserverTask(key, task, 'PORT');
    proxy._onListening(key, state, 3000);

    task.exit(137);

    expect(proxy.states.get(key)).toBe(state);
    expect(replayedEvents(proxy, key).at(-1)).toEqual({
      event: 'error',
      data: { message: 'Dev server exited with code 137.' },
    });
  });

  it('drops the state on an idle-TTL stop so the next request starts a fresh server', () => {
    const proxy = new DevProxy({}, []);
    const task = stubTask();
    const state = proxy.attachWebserverTask(key, task, 'PORT');
    proxy._onListening(key, state, 3000);

    task.kill_reason = 'ttl';
    task.exit(1);

    expect(proxy.states.has(key)).toBe(false);
    expect(replayedEvents(proxy, key)).toEqual([]);
  });
});
