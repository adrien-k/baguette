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

  return { sessionPlans: makeService(['find']), resetService };
});

vi.mock('../../feathers.js', () => ({ sessionPlansService: mocks.sessionPlans }));
vi.mock('../../utils/toastError.jsx', () => ({ toastError: vi.fn() }));

import { toastError } from '../../utils/toastError.jsx';
import { useGetSessionPlans } from '../useGetSessionPlans.js';

beforeEach(() => {
  mocks.resetService(mocks.sessionPlans);
  toastError.mockClear();
});

afterEach(cleanup);

async function flush() {
  await act(async () => {});
}

const PLAN_ROWS = [
  { id: 1, session_id: 5, ref: 2, status: 'open' },
  { id: 2, session_id: 5, ref: 1, status: 'open' },
];

async function loadPlans(index, rows) {
  await act(async () => {
    mocks.sessionPlans.find.queue[index].resolve(rows);
  });
}

describe('useGetSessionPlans', () => {
  it('loads every plan for a session and reloads on plan events', async () => {
    const { result } = renderHook((id) => useGetSessionPlans(id), { initialProps: 5 });
    await flush();
    expect(mocks.sessionPlans.find).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ session_id: 5 }),
      })
    );
    await loadPlans(0, PLAN_ROWS);
    expect(result.current.plans).toEqual(PLAN_ROWS);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      mocks.sessionPlans.emit('patched', { session_id: 5 });
    });
    await flush();
    expect(mocks.sessionPlans.find).toHaveBeenCalledTimes(2);
    await loadPlans(1, [...PLAN_ROWS, { id: 3, session_id: 5, ref: 3, status: 'completed' }]);
    expect(result.current.plans.map((p) => p.id)).toContain(3);
  });

  it('resets plans on session switch and ignores the stale response', async () => {
    const { result, rerender } = renderHook((id) => useGetSessionPlans(id), { initialProps: 5 });
    await flush();
    await loadPlans(0, PLAN_ROWS);
    expect(result.current.plans).toEqual(PLAN_ROWS);

    rerender(7);
    expect(result.current.plans).toEqual([]);
    await flush();
    expect(mocks.sessionPlans.find).toHaveBeenCalledTimes(2);
    expect(mocks.sessionPlans.find).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ session_id: 7 }),
      })
    );

    await act(async () => {
      mocks.sessionPlans.find.queue[0].resolve([{ id: 99, session_id: 5, ref: 1 }]); // stale, session 5
    });
    expect(result.current.plans).toEqual([]);
    expect(result.current.loading).toBe(true);

    await act(async () => {
      mocks.sessionPlans.find.queue[1].resolve([{ id: 8, session_id: 7, ref: 1 }]);
    });
    expect(result.current.plans).toEqual([{ id: 8, session_id: 7, ref: 1 }]);
    expect(result.current.loading).toBe(false);
  });

  it('ignores plan events for other sessions', async () => {
    renderHook((id) => useGetSessionPlans(id), { initialProps: 5 });
    await flush();
    await loadPlans(0, PLAN_ROWS);

    await act(async () => {
      mocks.sessionPlans.emit('created', { session_id: 999 });
    });
    await flush();
    expect(mocks.sessionPlans.find).toHaveBeenCalledTimes(1);
  });

  it('toasts the failure and falls back to an empty list', async () => {
    const { result } = renderHook((id) => useGetSessionPlans(id), { initialProps: 5 });
    await flush();
    await act(async () => {
      mocks.sessionPlans.find.queue[0].reject(new Error('boom'));
    });
    expect(toastError).toHaveBeenCalledWith('Failed to load plans', expect.anything());
    expect(result.current.plans).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
