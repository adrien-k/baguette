// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  const makeService = (methodNames) => {
    const listeners = [];
    const api = {};
    for (const name of methodNames) {
      const queue = [];
      const fn = vi.fn(() => {
        const d = deferred();
        queue.push(d);
        return d.promise;
      });
      fn.queue = queue;
      api[name] = fn;
    }
    api.on = (event, listener) => listeners.push({ event, listener });
    api.off = (event, listener) => {
      const index = listeners.findIndex((l) => l.event === event && l.listener === listener);
      if (index !== -1) listeners.splice(index, 1);
    };
    api.emit = (event, payload) => {
      for (const l of [...listeners]) {
        if (l.event === event) l.listener(payload);
      }
    };
    return api;
  };

  const resetService = (api) => {
    for (const key of Object.keys(api)) {
      const value = api[key];
      if (typeof value === 'function' && vi.isMockFunction(value)) {
        value.mockClear();
        if (Array.isArray(value.queue)) value.queue.length = 0;
      }
    }
  };

  return { tasks: makeService(['logs']), sseReconnect: { subscriptions: [] }, resetService };
});

vi.mock('../../utils/sseReconnect.js', () => ({
  subscribeSseReconnect: (listener) => {
    mocks.sseReconnect.subscriptions.push(listener);
    return () => {
      const index = mocks.sseReconnect.subscriptions.indexOf(listener);
      if (index !== -1) mocks.sseReconnect.subscriptions.splice(index, 1);
    };
  },
}));
vi.mock('../../utils/toastError.jsx', () => ({ toastFeathersError: vi.fn() }));

vi.mock('../../feathers.js', () => ({ tasksService: mocks.tasks }));

import { toastFeathersError } from '../../utils/toastError.jsx';
import { useGetTaskLogs } from '../useGetTaskLogs.js';

beforeEach(() => {
  mocks.resetService(mocks.tasks);
  mocks.sseReconnect.subscriptions.length = 0;
});

afterEach(cleanup);

async function flush() {
  await act(async () => {});
}

function emitLog(taskId, data) {
  return act(async () => {
    mocks.tasks.emit('log', { id: taskId, data });
  });
}

describe('useGetTaskLogs', () => {
  it('loads logs and appends SSE chunks for a current task', async () => {
    const { result } = renderHook((taskId) => useGetTaskLogs(taskId), { initialProps: 9 });
    await flush();
    expect(mocks.tasks.logs).toHaveBeenCalledWith(9);
    await act(async () => {
      mocks.tasks.logs.queue[0].resolve({ logs: 'base\n' });
    });
    expect(result.current.logs).toBe('base\n');

    await emitLog(9, 'chunk-1');
    expect(result.current.logs).toBe('base\nchunk-1');
    await emitLog(9, 'chunk-2');
    expect(result.current.logs).toBe('base\nchunk-1chunk-2');
  });

  it('ignores SSE chunks for a different task', async () => {
    const { result } = renderHook((taskId) => useGetTaskLogs(taskId), { initialProps: 9 });
    await flush();
    await act(async () => {
      mocks.tasks.logs.queue[0].resolve({ logs: 'base\n' });
    });

    await emitLog(77, 'OTHER-TASK');
    expect(mocks.tasks.logs).toHaveBeenCalledTimes(1);
    expect(result.current.logs).toBe('base\n');
  });

  it('resets logs on task switch and ignores stale appends', async () => {
    const { result, rerender } = renderHook((taskId) => useGetTaskLogs(taskId), {
      initialProps: 9,
    });
    await flush();
    await act(async () => {
      mocks.tasks.logs.queue[0].resolve({ logs: 'logs-9' });
    });
    expect(result.current.logs).toBe('logs-9');

    rerender(10);
    expect(result.current.logs).toBe('');
    await flush();
    expect(mocks.tasks.logs).toHaveBeenCalledTimes(2);
    expect(mocks.tasks.logs).toHaveBeenLastCalledWith(10);

    // Stale load for task 9 resolves late — must not overwrite task 10.
    await act(async () => {
      mocks.tasks.logs.queue[0].resolve({ logs: 'STALE-9' });
    });
    expect(result.current.logs).toBe('');

    await act(async () => {
      mocks.tasks.logs.queue[1].resolve({ logs: 'logs-10' });
    });
    expect(result.current.logs).toBe('logs-10');

    // SSE chunks belonging to task 9 must not append after the switch.
    await emitLog(9, 'STALE-APPEND');
    expect(result.current.logs).toBe('logs-10');
    await emitLog(10, '-appended');
    expect(result.current.logs).toBe('logs-10-appended');
  });

  it('clears logs when the task id is cleared', async () => {
    const { result, rerender } = renderHook((taskId) => useGetTaskLogs(taskId), {
      initialProps: 9,
    });
    await flush();
    await act(async () => {
      mocks.tasks.logs.queue[0].resolve({ logs: 'logs-9' });
    });
    expect(result.current.logs).toBe('logs-9');

    rerender(null);
    expect(result.current.logs).toBe('');
    await flush();
    // Late load or append for task 9 must stay ignored while no task is open.
    await act(async () => {
      mocks.tasks.logs.queue[0].resolve({ logs: 'LATE-9' });
    });
    expect(result.current.logs).toBe('');
  });

  it('refetches when the SSE stream reconnects', async () => {
    renderHook((taskId) => useGetTaskLogs(taskId), { initialProps: 9 });
    await flush();
    expect(mocks.sseReconnect.subscriptions).toHaveLength(1);

    expect(mocks.tasks.logs).toHaveBeenCalledTimes(1);
    const reconnect = mocks.sseReconnect.subscriptions[0];
    await act(async () => {
      reconnect();
    });
    await flush();
    expect(mocks.tasks.logs).toHaveBeenCalledTimes(2);
  });

  it('toasts failures and falls back to empty logs', async () => {
    const { result } = renderHook((taskId) => useGetTaskLogs(taskId), { initialProps: 9 });
    await flush();
    await act(async () => {
      mocks.tasks.logs.queue[0].reject(new Error('boom'));
    });
    expect(toastFeathersError).toHaveBeenCalledWith('Failed to load task logs', expect.anything());
    expect(result.current.logs).toBe('');
  });
});
