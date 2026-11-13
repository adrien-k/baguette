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

  return {
    sessions: makeService(['changedFiles']),
    resetService: (api) => {
      for (const key of Object.keys(api)) {
        const value = api[key];
        if (typeof value === 'function' && vi.isMockFunction(value)) {
          value.mockClear();
          if (Array.isArray(value.queue)) value.queue.length = 0;
        }
      }
    },
  };
});

vi.mock('../../feathers.js', () => ({ sessionsService: mocks.sessions }));
vi.mock('../../utils/toastError.jsx', () => ({ toastFeathersError: vi.fn() }));

import { toastFeathersError } from '../../utils/toastError.jsx';
import { useSessionChangedFiles } from '../useSessionChangedFiles.js';

const SESSION = { id: 5 };

function renderFiles({ session = SESSION, commitSha = null, enabled = true }) {
  return renderHook(
    ({ sessionArg, commitShaArg, enabledArg }) =>
      useSessionChangedFiles(sessionArg, commitShaArg, enabledArg),
    { initialProps: { sessionArg: session, commitShaArg: commitSha, enabledArg: enabled } }
  );
}

beforeEach(() => {
  mocks.resetService(mocks.sessions);
  toastFeathersError.mockClear();
});

afterEach(cleanup);

async function flush() {
  await act(async () => {});
}

const SESSION_RESPONSE = {
  files: [{ old_path: 'a.js', new_path: 'a.js', added_count: 2, removed_count: 1 }],
};
const COMMIT_C1_RESPONSE = {
  files: [{ old_path: null, new_path: 'b.js', added_count: 5, removed_count: 0 }],
};

describe('useSessionChangedFiles', () => {
  it('does not fetch while disabled', async () => {
    const { result } = renderFiles({ enabled: false });
    await flush();
    expect(mocks.sessions.changedFiles).not.toHaveBeenCalled();
    expect(result.current.files).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it('fetches session files for the session view and switches keys for a commit view', async () => {
    const { result, rerender } = renderFiles({ commitSha: null });
    await flush();
    expect(mocks.sessions.changedFiles).toHaveBeenCalledTimes(1);
    expect(mocks.sessions.changedFiles).toHaveBeenLastCalledWith(5);
    expect(result.current.loading).toBe(true);
    await act(async () => {
      mocks.sessions.changedFiles.queue[0].resolve(SESSION_RESPONSE);
    });
    expect(result.current.files).toEqual([
      { oldPath: 'a.js', newPath: 'a.js', addedCount: 2, removedCount: 1 },
    ]);
    expect(result.current.loading).toBe(false);

    // Commit view: separate resource keyed by (session, sha); a new fetch for
    // the commit view begins while the session fetch is not repeated.
    rerender({ sessionArg: SESSION, commitShaArg: 'c1', enabledArg: true });
    await flush();
    expect(mocks.sessions.changedFiles).toHaveBeenCalledTimes(2);
    expect(mocks.sessions.changedFiles).toHaveBeenLastCalledWith({ id: 5, commit: 'c1' });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      mocks.sessions.changedFiles.queue[1].resolve(COMMIT_C1_RESPONSE);
    });
    expect(result.current.files).toEqual([
      { oldPath: null, newPath: 'b.js', addedCount: 5, removedCount: 0 },
    ]);

    // Back to the session view: the session resource is enabled again and
    // refetches, but its previously bound files keep being displayed.
    rerender({ sessionArg: SESSION, commitShaArg: null, enabledArg: true });
    await flush();
    expect(mocks.sessions.changedFiles).toHaveBeenCalledTimes(3);
    expect(result.current.files).toEqual([
      { oldPath: 'a.js', newPath: 'a.js', addedCount: 2, removedCount: 1 },
    ]);
    await act(async () => {
      mocks.sessions.changedFiles.queue[2].resolve(SESSION_RESPONSE);
    });
    expect(result.current.files).toEqual([
      { oldPath: 'a.js', newPath: 'a.js', addedCount: 2, removedCount: 1 },
    ]);
    expect(result.current.loading).toBe(false);
  });

  it('reuses a cached commit list when switching back to the same sha (no refetch)', async () => {
    const { result, rerender } = renderFiles({ commitSha: null });
    await flush();
    await act(async () => {
      mocks.sessions.changedFiles.queue[0].resolve(SESSION_RESPONSE);
    });

    rerender({ sessionArg: SESSION, commitShaArg: 'c1', enabledArg: true });
    await flush();
    expect(mocks.sessions.changedFiles).toHaveBeenCalledTimes(2);
    await act(async () => {
      mocks.sessions.changedFiles.queue[1].resolve(COMMIT_C1_RESPONSE);
    });
    const firstCommitFiles = result.current.files;
    expect(firstCommitFiles).toEqual([
      { oldPath: null, newPath: 'b.js', addedCount: 5, removedCount: 0 },
    ]);

    rerender({ sessionArg: SESSION, commitShaArg: null, enabledArg: true });
    await flush();
    expect(mocks.sessions.changedFiles).toHaveBeenCalledTimes(3);
    await act(async () => {
      mocks.sessions.changedFiles.queue[2].resolve(SESSION_RESPONSE);
    });
    rerender({ sessionArg: SESSION, commitShaArg: 'c1', enabledArg: true });
    await flush();
    // Cache hit: no commit refetch, and the exact cached array is returned.
    expect(mocks.sessions.changedFiles).toHaveBeenCalledTimes(3);
    expect(result.current.files).toBe(firstCommitFiles);
    expect(result.current.loading).toBe(false);
  });

  it('invalidates the cached commit and refetches on refresh()', async () => {
    const { result } = renderFiles({ commitSha: 'c1' });
    await flush();
    await act(async () => {
      mocks.sessions.changedFiles.queue[0].resolve(COMMIT_C1_RESPONSE);
    });
    const cached = result.current.files;

    await act(async () => {
      result.current.refresh();
    });
    await flush();
    expect(mocks.sessions.changedFiles).toHaveBeenCalledTimes(2);
    expect(mocks.sessions.changedFiles).toHaveBeenLastCalledWith({ id: 5, commit: 'c1' });
    await act(async () => {
      mocks.sessions.changedFiles.queue[1].resolve({
        files: [{ old_path: null, new_path: 'b2.js', added_count: 1, removed_count: 0 }],
      });
    });
    expect(result.current.files).not.toBe(cached);
    expect(result.current.files).toEqual([
      { oldPath: null, newPath: 'b2.js', addedCount: 1, removedCount: 0 },
    ]);
  });

  it('serves session-switched commit views only from fresh data (no stale cache leak)', async () => {
    const { result, rerender } = renderFiles({ commitSha: 'c1' });
    await flush();
    await act(async () => {
      mocks.sessions.changedFiles.queue[0].resolve(COMMIT_C1_RESPONSE);
    });
    expect(result.current.files).toEqual([
      { oldPath: null, newPath: 'b.js', addedCount: 5, removedCount: 0 },
    ]);

    rerender({ sessionArg: { id: 9 }, commitShaArg: null, enabledArg: true });
    await flush();
    await act(async () => {
      mocks.sessions.changedFiles.queue[1].resolve({ files: [] });
    });

    rerender({ sessionArg: { id: 9 }, commitShaArg: 'c1', enabledArg: true });
    await flush();
    // Session 5's cached files must not answer for session 9: refetch happens.
    expect(mocks.sessions.changedFiles).toHaveBeenCalledTimes(3);
    expect(mocks.sessions.changedFiles).toHaveBeenLastCalledWith({ id: 9, commit: 'c1' });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      mocks.sessions.changedFiles.queue[2].resolve(COMMIT_C1_RESPONSE);
    });
    expect(result.current.files).toEqual([
      { oldPath: null, newPath: 'b.js', addedCount: 5, removedCount: 0 },
    ]);
  });

  it('drops stale session responses after a session switch', async () => {
    const { result, rerender } = renderFiles({ commitSha: null });
    await flush();

    rerender({ sessionArg: { id: 9 }, commitShaArg: null, enabledArg: true });
    await flush();
    expect(mocks.sessions.changedFiles).toHaveBeenCalledTimes(2);

    await act(async () => {
      mocks.sessions.changedFiles.queue[0].resolve({ files: [{ old_path: 'stale.js' }] });
    });
    expect(result.current.files).toBeUndefined();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      mocks.sessions.changedFiles.queue[1].resolve({ files: [{ new_path: 'nine.js' }] });
    });
    expect(result.current.files).toEqual([
      { oldPath: undefined, newPath: 'nine.js', addedCount: undefined, removedCount: undefined },
    ]);
  });

  it('toasts failures and falls back to an empty list', async () => {
    const { result } = renderFiles({ commitSha: null });
    await flush();
    await act(async () => {
      mocks.sessions.changedFiles.queue[0].reject(new Error('boom'));
    });
    expect(toastFeathersError).toHaveBeenCalledWith(
      'Failed to load changed files',
      expect.anything()
    );
    expect(result.current.files).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('toasts and falls back to empty on a 200-with-error payload', async () => {
    const { result } = renderFiles({ commitSha: null });
    await flush();
    await act(async () => {
      mocks.sessions.changedFiles.queue[0].resolve({ error: 'git failed' });
    });
    expect(toastFeathersError).toHaveBeenCalledTimes(1);
    expect(result.current.files).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
