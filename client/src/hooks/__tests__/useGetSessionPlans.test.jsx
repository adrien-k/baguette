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

  const makeService = () => {
    const queue = [];
    const find = vi.fn(() => {
      const d = deferred();
      queue.push(d);
      return d.promise;
    });
    find.queue = queue;
    return { find, listeners: [] };
  };

  return { sessionPlans: makeService() };
});

vi.mock('../../feathers.js', () => ({
  sessionPlansService: { find: mocks.sessionPlans.find },
}));
vi.mock('../../utils/toastError.jsx', () => ({ toastError: vi.fn() }));

import { toastError } from '../../utils/toastError.jsx';
import { createTestQueryClient, makeQueryClientWrapper } from '../../queries/testUtils.jsx';
import { sessionPlanKeys } from '../../queries/keys.js';
import { useGetSessionPlans } from '../useGetSessionPlans.js';

beforeEach(() => {
  mocks.sessionPlans.find.mockClear();
  mocks.sessionPlans.find.queue.length = 0;
  toastError.mockClear();
});

afterEach(cleanup);

const PLAN_ROWS = [
  { id: 1, session_id: 5, ref: 2, status: 'open' },
  { id: 2, session_id: 5, ref: 1, status: 'open' },
];

async function loadPlans(index, rows) {
  await act(async () => {
    mocks.sessionPlans.find.queue[index].resolve(rows);
  });
}

describe('useGetSessionPlans (React Query)', () => {
  it('loads every plan for a session and refetches when the entry is invalidated', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook((id) => useGetSessionPlans(id), {
      initialProps: 5,
      wrapper: makeQueryClientWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(mocks.sessionPlans.find).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ session_id: 5 }),
      })
    );

    await loadPlans(0, PLAN_ROWS);
    await waitFor(() => expect(result.current.plans).toEqual(PLAN_ROWS));

    // The cache bridge invalidates the entry on plan SSE events; refetch follows.
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: sessionPlanKeys.session(5) });
    });
    await waitFor(() => expect(mocks.sessionPlans.find).toHaveBeenCalledTimes(2));
    await loadPlans(1, [...PLAN_ROWS, { id: 3, session_id: 5, ref: 3, status: 'completed' }]);
    await waitFor(() => expect(result.current.plans.map((p) => p.id)).toContain(3));
  });

  it('resets plans on session switch and ignores the stale response', async () => {
    const { result, rerender } = renderHook((id) => useGetSessionPlans(id), {
      initialProps: 5,
      wrapper: makeQueryClientWrapper(createTestQueryClient()),
    });
    await loadPlans(0, PLAN_ROWS);
    await waitFor(() => expect(result.current.plans).toEqual(PLAN_ROWS));

    rerender(7);
    expect(result.current.plans).toEqual([]);
    await waitFor(() =>
      expect(mocks.sessionPlans.find).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ session_id: 7 }),
        })
      )
    );

    // Stale resolve for session 5 lands in its own (inactive) cache entry.
    await loadPlans(0, [{ id: 99, session_id: 5, ref: 1 }]);
    expect(result.current.plans).toEqual([]);

    await act(async () => {
      mocks.sessionPlans.find.queue[1].resolve([{ id: 8, session_id: 7, ref: 1 }]);
    });
    await waitFor(() => expect(result.current.plans).toEqual([{ id: 8, session_id: 7, ref: 1 }]));
    expect(result.current.loading).toBe(false);
  });

  it('toasts the failure and falls back to an empty list', async () => {
    const { result } = renderHook((id) => useGetSessionPlans(id), {
      initialProps: 5,
      wrapper: makeQueryClientWrapper(createTestQueryClient()),
    });
    await act(async () => {
      mocks.sessionPlans.find.queue[0].reject(new Error('boom'));
    });
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Failed to load plans', expect.anything())
    );
    expect(result.current.plans).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
