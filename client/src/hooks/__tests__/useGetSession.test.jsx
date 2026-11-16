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

  const makeFn = () => {
    const queue = [];
    const fn = vi.fn(() => {
      const d = deferred();
      queue.push(d);
      return d.promise;
    });
    fn.queue = queue;
    return fn;
  };

  return {
    sessionsGet: makeFn(),
    issuesFind: makeFn(),
    tasksFind: makeFn(),
  };
});

vi.mock('../../feathers.js', () => ({
  sessionsService: { get: mocks.sessionsGet },
  sessionIssuesService: { find: mocks.issuesFind },
  tasksService: { find: mocks.tasksFind },
}));

import { createTestQueryClient, makeQueryClientWrapper } from '../../queries/testUtils.jsx';
import { useGetSession } from '../useGetSession.js';

// React Query batches observer notifications with setTimeout(0); assertions
// after resolving a fetch go through `waitFor`.

let queryClient;

beforeEach(() => {
  mocks.sessionsGet.mockClear();
  mocks.issuesFind.mockClear();
  mocks.tasksFind.mockClear();
  mocks.sessionsGet.queue.length = 0;
  mocks.issuesFind.queue.length = 0;
  mocks.tasksFind.queue.length = 0;
  queryClient = createTestQueryClient();
});

afterEach(cleanup);

describe('useGetSession (React Query)', () => {
  it('loads a session and runs the counts queries alongside', async () => {
    const { result } = renderHook(() => useGetSession(42), {
      wrapper: makeQueryClientWrapper(queryClient),
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      mocks.sessionsGet.queue[0].resolve({
        id: 42,
        status: 'running',
        open_issues_count: 2,
        running_tasks_count: 1,
      });
      mocks.issuesFind.queue[0].resolve({ total: 2, data: [] });
      mocks.tasksFind.queue[0].resolve({ total: 1, data: [] });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.session).toMatchObject({ id: 42, status: 'running' });
    expect(result.current.loading).toBe(false);
  });

  it('treats new-session routes as disabled and idle', () => {
    const { result } = renderHook(() => useGetSession('new'), {
      wrapper: makeQueryClientWrapper(queryClient),
    });
    expect(result.current.session).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mocks.sessionsGet).not.toHaveBeenCalled();
  });

  it('exposes errors for missing sessions', async () => {
    const { result } = renderHook(() => useGetSession(999), {
      wrapper: makeQueryClientWrapper(queryClient),
    });
    await act(async () => {
      mocks.sessionsGet.queue[0].reject({ code: 404, name: 'NotFound', message: 'not found' });
      mocks.issuesFind.queue[0].resolve({ total: 0, data: [] });
      mocks.tasksFind.queue[0].resolve({ total: 0, data: [] });
    });
    await waitFor(() => expect(result.current.error).toMatchObject({ code: 404 }));
    expect(result.current.session).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
