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

  return { sessions: makeService(['branchCommits']), resetService };
});

vi.mock('../../feathers.js', () => ({ sessionsService: mocks.sessions }));
vi.mock('../../utils/toastError.jsx', () => ({ toastFeathersError: vi.fn() }));

import { toastFeathersError } from '../../utils/toastError.jsx';
import { useSessionBranchCommits } from '../useSessionBranchCommits.js';

const SESSION = { id: 5 };
const GLOBAL_SESSION = { id: 5, is_global: true };

function renderCommits({ session, enabled }) {
  return renderHook(
    ({ sessionArg, enabledArg }) => useSessionBranchCommits(sessionArg, enabledArg),
    {
      initialProps: { sessionArg: session, enabledArg: enabled },
    }
  );
}

beforeEach(() => mocks.resetService(mocks.sessions));

afterEach(cleanup);

async function flush() {
  await act(async () => {});
}

describe('useSessionBranchCommits', () => {
  it('loads commits once per session when enabled, and not before', async () => {
    const { result, rerender } = renderCommits({ session: SESSION, enabled: false });
    await flush();
    expect(mocks.sessions.branchCommits).not.toHaveBeenCalled();
    // Not yet bound to the scope: undefined rather than a placeholder list.
    expect(result.current.commits).toBeUndefined();
    expect(result.current.loading).toBe(false);

    rerender({ sessionArg: SESSION, enabledArg: true });
    await flush();
    expect(mocks.sessions.branchCommits).toHaveBeenCalledTimes(1);
    expect(mocks.sessions.branchCommits).toHaveBeenCalledWith(5);
    expect(result.current.loading).toBe(true);
    await act(async () => {
      mocks.sessions.branchCommits.queue[0].resolve({ commits: [{ sha: 'abc' }] });
    });
    expect(result.current.commits).toEqual([{ sha: 'abc' }]);
    expect(result.current.loading).toBe(false);
  });

  it('never fetches for global sessions', async () => {
    const { result } = renderCommits({ session: GLOBAL_SESSION, enabled: true });
    await flush();
    expect(mocks.sessions.branchCommits).not.toHaveBeenCalled();
    expect(result.current.commits).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('drops commits on session switch and ignores the stale response', async () => {
    const { result, rerender } = renderCommits({ session: SESSION, enabled: true });
    await flush();
    await act(async () => {
      mocks.sessions.branchCommits.queue[0].resolve({ commits: [{ sha: '5.1' }] });
    });
    expect(result.current.commits).toEqual([{ sha: '5.1' }]);

    rerender({ sessionArg: { id: 9 }, enabledArg: true });
    expect(result.current.commits).toBeUndefined();
    await flush();
    expect(result.current.commits).toBeUndefined();
    expect(mocks.sessions.branchCommits).toHaveBeenCalledTimes(2);
    expect(mocks.sessions.branchCommits).toHaveBeenLastCalledWith(9);

    await act(async () => {
      mocks.sessions.branchCommits.queue[0].resolve({ commits: [{ sha: 'STALE' }] });
    });
    expect(result.current.commits).toBeUndefined();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      mocks.sessions.branchCommits.queue[1].resolve({ commits: [{ sha: '9.1' }] });
    });
    expect(result.current.commits).toEqual([{ sha: '9.1' }]);
    expect(result.current.loading).toBe(false);
  });

  it('refetches on turn completion for the same session and on refresh()', async () => {
    const { result } = renderCommits({ session: SESSION, enabled: true });
    await flush();
    await act(async () => {
      mocks.sessions.branchCommits.queue[0].resolve({ commits: [] });
    });
    expect(mocks.sessions.branchCommits).toHaveBeenCalledTimes(1);

    await act(async () => {
      mocks.sessions.emit('turn:complete', { session_id: 5 });
    });
    await flush();
    expect(mocks.sessions.branchCommits).toHaveBeenCalledTimes(2);

    await act(async () => {
      result.current.refresh();
    });
    await flush();
    expect(mocks.sessions.branchCommits).toHaveBeenCalledTimes(3);

    await act(async () => {
      mocks.sessions.emit('turn:complete', { session_id: 888 });
    });
    await flush();
    expect(mocks.sessions.branchCommits).toHaveBeenCalledTimes(3);
  });

  it('toasts failures and falls back to an empty list', async () => {
    const { result } = renderCommits({ session: SESSION, enabled: true });
    await flush();
    await act(async () => {
      mocks.sessions.branchCommits.queue[0].reject(new Error('boom'));
    });
    expect(toastFeathersError).toHaveBeenCalledWith('Failed to load commits', expect.anything());
    expect(result.current.commits).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
