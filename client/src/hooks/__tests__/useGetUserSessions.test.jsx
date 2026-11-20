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

  const makeFind = () => {
    const queue = [];
    const fn = vi.fn(() => {
      const d = deferred();
      queue.push(d);
      return d.promise;
    });
    fn.queue = queue;
    return fn;
  };

  return { sessionsFind: makeFind() };
});

vi.mock('../../feathers.js', () => ({
  sessionsService: { find: mocks.sessionsFind },
  agentsService: {},
}));

import { createTestQueryClient, makeQueryClientWrapper } from '../../queries/testUtils.jsx';
import { sessionKeys } from '../../queries/keys.js';
import { applySessionEventToInfiniteList } from '../../queries/sessionCacheUpdaters.js';
import { useGetUserSessions } from '../useGetUserSessions.js';

// React Query batches observer notifications with setTimeout(0), so assertions
// after resolving a fetch must go through `waitFor` (plain act flushes only
// microtasks and misses the batched update).
function pageOf(rows, total) {
  return { data: rows, total };
}

const FIRST_PAGE = [
  { id: 1, user_id: 7, status: 'running', last_activity_at: '2026-01-02T00:00:00.000Z' },
  { id: 2, user_id: 7, status: 'idle', last_activity_at: '2026-01-01T00:00:00.000Z' },
];
const SECOND_PAGE = [
  { id: 3, user_id: 7, status: 'idle', last_activity_at: '2025-12-31T00:00:00.000Z' },
];

let queryClient;

beforeEach(() => {
  mocks.sessionsFind.mockClear();
  mocks.sessionsFind.queue.length = 0;
  queryClient = createTestQueryClient();
});

afterEach(cleanup);

async function resolvePage(index, payload) {
  await act(async () => {
    mocks.sessionsFind.queue[index].resolve(payload);
  });
}

describe('useGetUserSessions (React Query)', () => {
  it('loads the first page sorted for the list', async () => {
    const { result } = renderHook(() => useGetUserSessions({ all_sessions: true }), {
      wrapper: makeQueryClientWrapper(queryClient),
    });
    expect(result.current.loading).toBe(true);

    await resolvePage(0, pageOf(FIRST_PAGE, 3));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sessions.map((s) => s.id)).toEqual([1, 2]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('loadMore appends the next page without duplicates', async () => {
    const { result } = renderHook(() => useGetUserSessions({}), {
      wrapper: makeQueryClientWrapper(queryClient),
    });
    await resolvePage(0, pageOf(FIRST_PAGE, 3));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore());
    await waitFor(() => expect(mocks.sessionsFind).toHaveBeenCalledTimes(2));
    await resolvePage(1, pageOf(SECOND_PAGE, 3));

    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(result.current.sessions.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it('refetch reloads and keeps prior data while in flight', async () => {
    const { result } = renderHook(() => useGetUserSessions({}), {
      wrapper: makeQueryClientWrapper(queryClient),
    });
    await resolvePage(0, pageOf(FIRST_PAGE, 2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      void result.current.refetch();
    });
    await waitFor(() => expect(mocks.sessionsFind).toHaveBeenCalledTimes(2));
    // Data stays visible while the refetch is in flight (silent semantics).
    expect(result.current.sessions.map((s) => s.id)).toEqual([1, 2]);

    await resolvePage(1, pageOf([FIRST_PAGE[1]], 1));
    await waitFor(() => expect(result.current.sessions.map((s) => s.id)).toEqual([2]));
  });

  it('loadMore offset stays in sync after realtime inserts duplicate rows across pages', async () => {
    // Regression: the bridge prepends a not-yet-loaded row to EVERY page, so
    // raw page counts overstate the window and the next `$skip` used to skip
    // server rows permanently.
    const rows = (from, to) =>
      Array.from({ length: to - from + 1 }, (_, i) => ({
        id: from + i,
        user_id: 7,
        status: 'idle',
      }));
    const { result } = renderHook(() => useGetUserSessions({}), {
      wrapper: makeQueryClientWrapper(queryClient),
    });

    await act(async () => {
      mocks.sessionsFind.queue[0].resolve(pageOf(rows(101, 150), 250));
    });
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore());
    await waitFor(() => expect(mocks.sessionsFind).toHaveBeenCalledTimes(2));
    await act(async () => {
      mocks.sessionsFind.queue[1].resolve(pageOf(rows(51, 100), 250));
    });
    await waitFor(() => expect(result.current.sessions).toHaveLength(100));

    // Realtime `created` event: the bridge inserts the row into every page
    // where it is missing (both pages), duplicating it in the cache.
    const created = { id: 999, user_id: 7, status: 'running' };
    await act(async () => {
      queryClient.setQueryData(sessionKeys.list({}), (data) =>
        applySessionEventToInfiniteList(data, created, () => true)
      );
    });
    await waitFor(() => expect(result.current.sessions).toHaveLength(101));

    act(() => result.current.loadMore());
    await waitFor(() => expect(mocks.sessionsFind).toHaveBeenCalledTimes(3));
    // 101 unique rows loaded → next page must resume at server position 101,
    // not at the raw (duplicated) count of 102.
    expect(mocks.sessionsFind).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ $skip: 101, $limit: 50 }),
    });
  });

  it('exposes fetch errors and clears sessions', async () => {
    const { result } = renderHook(() => useGetUserSessions({}), {
      wrapper: makeQueryClientWrapper(queryClient),
    });
    await act(async () => {
      mocks.sessionsFind.queue[0].reject(new Error('boom'));
    });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.sessions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
