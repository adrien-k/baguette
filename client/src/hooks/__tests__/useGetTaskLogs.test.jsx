// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

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
      if (typeof value === 'function' && Array.isArray(value.queue)) {
        value.queue.length = 0;
      }
      if (typeof value === 'function' && vi.isMockFunction(value)) {
        value.mockClear();
      }
    }
  };

  return { tasks: makeService(['logs']), resetService };
});

vi.mock('../../utils/toastError.jsx', () => ({ toastFeathersError: vi.fn() }));
vi.mock('../../feathers.js', () => ({ tasksService: mocks.tasks }));

import { toastFeathersError } from '../../utils/toastError.jsx';
import { createTestQueryClient, makeQueryClientWrapper } from '../../queries/testUtils.jsx';
import { useGetTaskLogs } from '../useGetTaskLogs.js';

beforeEach(() => {
  mocks.resetService(mocks.tasks);
  toastFeathersError.mockClear();
});

afterEach(cleanup);

function emitLog(taskId, data) {
  return act(async () => {
    mocks.tasks.emit('log', { id: taskId, data });
  });
}

describe('useGetTaskLogs (React Query)', () => {
  it('loads logs and appends SSE chunks for a current task', async () => {
    const { result } = renderHook((taskId) => useGetTaskLogs(taskId), {
      initialProps: 9,
      wrapper: makeQueryClientWrapper(createTestQueryClient()),
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    await act(async () => {
      mocks.tasks.logs.queue[0].resolve({ logs: 'base\n' });
    });
    await waitFor(() => expect(result.current.logs).toBe('base\n'));

    await emitLog(9, 'chunk-1');
    await waitFor(() => expect(result.current.logs).toBe('base\nchunk-1'));
    await emitLog(9, 'chunk-2');
    await waitFor(() => expect(result.current.logs).toBe('base\nchunk-1chunk-2'));
  });

  it('ignores SSE chunks for a different task', async () => {
    const { result } = renderHook((taskId) => useGetTaskLogs(taskId), {
      initialProps: 9,
      wrapper: makeQueryClientWrapper(createTestQueryClient()),
    });
    await act(async () => {
      mocks.tasks.logs.queue[0].resolve({ logs: 'base\n' });
    });
    await waitFor(() => expect(result.current.logs).toBe('base\n'));

    await emitLog(77, 'OTHER-TASK');
    await act(async () => {});
    expect(result.current.logs).toBe('base\n');
  });

  it('resets logs on task switch and ignores stale appends', async () => {
    const { result, rerender } = renderHook((taskId) => useGetTaskLogs(taskId), {
      initialProps: 9,
      wrapper: makeQueryClientWrapper(createTestQueryClient()),
    });
    await act(async () => {
      mocks.tasks.logs.queue[0].resolve({ logs: 'logs-9' });
    });
    await waitFor(() => expect(result.current.logs).toBe('logs-9'));

    rerender(10);
    expect(result.current.logs).toBe('');
    await waitFor(() => expect(mocks.tasks.logs).toHaveBeenLastCalledWith(10));

    // Stale load for task 9 resolves late — must not overwrite task 10.
    await act(async () => {
      mocks.tasks.logs.queue[0].resolve({ logs: 'STALE-9' });
    });
    expect(result.current.logs).toBe('');

    await act(async () => {
      mocks.tasks.logs.queue[1].resolve({ logs: 'logs-10' });
    });
    await waitFor(() => expect(result.current.logs).toBe('logs-10'));

    // SSE chunks belonging to task 9 must not append after the switch.
    await emitLog(9, 'STALE-APPEND');
    await act(async () => {});
    expect(result.current.logs).toBe('logs-10');
    await emitLog(10, '-appended');
    await waitFor(() => expect(result.current.logs).toBe('logs-10-appended'));
  });

  it('clears logs when the task id is cleared', async () => {
    const { result, rerender } = renderHook((taskId) => useGetTaskLogs(taskId), {
      initialProps: 9,
      wrapper: makeQueryClientWrapper(createTestQueryClient()),
    });
    await act(async () => {
      mocks.tasks.logs.queue[0].resolve({ logs: 'logs-9' });
    });
    await waitFor(() => expect(result.current.logs).toBe('logs-9'));

    rerender(null);
    expect(result.current.logs).toBe('');
    // Late load for task 9 must stay ignored while no task is open.
    await act(async () => {
      mocks.tasks.logs.queue[0].resolve({ logs: 'LATE-9' });
    });
    await act(async () => {});
    expect(result.current.logs).toBe('');
  });

  it('toasts failures and falls back to empty logs', async () => {
    const { result } = renderHook((taskId) => useGetTaskLogs(taskId), {
      initialProps: 9,
      wrapper: makeQueryClientWrapper(createTestQueryClient()),
    });
    await act(async () => {
      mocks.tasks.logs.queue[0].reject(new Error('boom'));
    });
    await waitFor(() =>
      expect(toastFeathersError).toHaveBeenCalledWith('Failed to load task logs', expect.anything())
    );
    expect(result.current.logs).toBe('');
  });
});
