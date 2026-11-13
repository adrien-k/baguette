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
      if (typeof value === 'function' && Array.isArray(value.queue)) {
        value.queue.length = 0;
      }
      if (typeof value === 'function' && vi.isMockFunction(value)) {
        value.mockClear();
      }
    }
  };

  return { sessionUsageService: makeService(['sessionUsage']), resetService };
});

vi.mock('../../feathers.js', () => ({ sessionsService: mocks.sessionUsageService }));

import { useSessionUsage } from '../useSessionUsage.js';

beforeEach(() => mocks.resetService(mocks.sessionUsageService));

afterEach(cleanup);

async function flush() {
  await act(async () => {});
}

describe('useSessionUsage', () => {
  it('loads usage for a session and refetches when an agent turn completes', async () => {
    const { result } = renderHook((id) => useSessionUsage(id), { initialProps: 101 });
    await flush();
    expect(mocks.sessionUsageService.sessionUsage).toHaveBeenCalledWith(101);
    await act(async () => {
      mocks.sessionUsageService.sessionUsage.queue[0].resolve({ total_tokens: 10 });
    });
    expect(result.current.usage).toEqual({ total_tokens: 10 });
    expect(result.current.loading).toBe(false);

    await act(async () => {
      mocks.sessionUsageService.emit('turn:complete', { session_id: 101 });
    });
    await flush();
    expect(mocks.sessionUsageService.sessionUsage).toHaveBeenCalledTimes(2);
    await act(async () => {
      mocks.sessionUsageService.sessionUsage.queue[1].resolve({ total_tokens: 22 });
    });
    expect(result.current.usage).toEqual({ total_tokens: 22 });
    expect(result.current.loading).toBe(false);
  });

  it('ignores turn completion events for another session', async () => {
    renderHook((id) => useSessionUsage(id), { initialProps: 101 });
    await flush();
    expect(mocks.sessionUsageService.sessionUsage).toHaveBeenCalledTimes(1);

    await act(async () => {
      mocks.sessionUsageService.emit('turn:complete', { session_id: 999 });
    });
    await flush();
    expect(mocks.sessionUsageService.sessionUsage).toHaveBeenCalledTimes(1);
  });

  it('resets usage on session switch and ignores the stale response', async () => {
    const { result, rerender } = renderHook((id) => useSessionUsage(id), { initialProps: 101 });
    await flush();
    expect(result.current.loading).toBe(true);

    rerender(202);
    expect(result.current.usage).toBeNull();
    await flush();
    expect(mocks.sessionUsageService.sessionUsage).toHaveBeenCalledTimes(2);
    expect(mocks.sessionUsageService.sessionUsage).toHaveBeenLastCalledWith(202);

    await act(async () => {
      mocks.sessionUsageService.sessionUsage.queue[0].resolve({ total_tokens: 10 }); // late, for 101
    });
    expect(result.current.usage).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      mocks.sessionUsageService.sessionUsage.queue[1].resolve({ total_tokens: 30 });
    });
    expect(result.current.usage).toEqual({ total_tokens: 30 });
    expect(result.current.loading).toBe(false);
  });

  it('stops loading when the usage request fails', async () => {
    const { result } = renderHook((id) => useSessionUsage(id), { initialProps: 101 });
    await flush();
    await act(async () => {
      mocks.sessionUsageService.sessionUsage.queue[0].reject(new Error('boom'));
    });
    expect(result.current.usage).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
