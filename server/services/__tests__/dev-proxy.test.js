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
