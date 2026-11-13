// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useScopedResource } from '../useScopedResource.js';

afterEach(cleanup);

/** Controlled promise so test resolvers can be ordered explicitly. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** `load` mock whose resolves are queued in fetch order. */
function queuedLoad() {
  const queue = [];
  const load = vi.fn(() => {
    const d = deferred();
    queue.push(d);
    return d.promise;
  });
  return { load, queue };
}

async function flush() {
  await act(async () => {});
}

function renderScoped(initial) {
  return renderHook(({ scopeKey, ...options }) => useScopedResource(scopeKey, options), {
    initialProps: initial,
  });
}

describe('useScopedResource', () => {
  it('returns empty/loading until a load for the current scope key resolves', async () => {
    const { load, queue } = queuedLoad();
    const { result } = renderScoped({ scopeKey: 'a', empty: null, load });
    await flush();

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => {
      queue[0].resolve('A');
    });
    expect(result.current.data).toBe('A');
    expect(result.current.loading).toBe(false);
  });

  it('does not refetch when only the load function identity changes', async () => {
    const { load, queue } = queuedLoad();
    const { result, rerender } = renderScoped({ scopeKey: 'a', empty: null, load });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);

    rerender({ scopeKey: 'a', empty: null, load: vi.fn(() => Promise.resolve('nope')) });
    await flush();
    expect(result.current.data).toBeNull();

    await act(async () => {
      queue[0].resolve('A');
    });
    expect(result.current.data).toBe('A');
  });

  it('resets data/loading for the new key and rejects late responses from the old key', async () => {
    const { load, queue } = queuedLoad();
    const { result, rerender } = renderScoped({ scopeKey: 'a', empty: 'EMPTY', load });
    await flush();
    await act(async () => {
      queue[0].resolve('A1');
    });
    expect(result.current.data).toBe('A1');

    rerender({ scopeKey: 'b', empty: 'EMPTY', load });
    // The reset happens synchronously on key change, before the new fetch starts.
    expect(result.current.data).toBe('EMPTY');
    expect(result.current.loading).toBe(true);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => {
      queue[0].resolve('LATE-A1');
    });
    expect(result.current.data).toBe('EMPTY');
    expect(result.current.loading).toBe(true);

    await act(async () => {
      queue[1].resolve('B1');
    });
    expect(result.current.data).toBe('B1');
    expect(result.current.loading).toBe(false);
  });

  it('ignores responses from an abandoned key when the key switches back quickly', async () => {
    const { load, queue } = queuedLoad();
    const { result, rerender } = renderScoped({ scopeKey: 'a', empty: 'EMPTY', load });
    await flush();
    await act(async () => {
      queue[0].resolve('A1');
    });

    rerender({ scopeKey: 'b', empty: 'EMPTY', load });
    await flush();
    rerender({ scopeKey: 'a', empty: 'EMPTY', load });
    await flush();
    expect(load).toHaveBeenCalledTimes(3);

    await act(async () => {
      queue[1].resolve('LATE-B');
    });
    expect(result.current.data).toBe('A1');
    expect(result.current.loading).toBe(true);

    await act(async () => {
      queue[2].resolve('A2');
    });
    expect(result.current.data).toBe('A2');
    expect(result.current.loading).toBe(false);
  });

  it('refetches on revision bump with last-wins ordering', async () => {
    const { load, queue } = queuedLoad();
    const { result, rerender } = renderScoped({ scopeKey: 'k', empty: 'EMPTY', load, revision: 0 });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);

    rerender({ scopeKey: 'k', empty: 'EMPTY', load, revision: 1 });
    await flush();
    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => {
      queue[0].resolve('STALE');
    });
    expect(result.current.data).toBe('EMPTY');
    expect(result.current.loading).toBe(true);

    await act(async () => {
      queue[1].resolve('REV1');
    });
    expect(result.current.data).toBe('REV1');
    expect(result.current.loading).toBe(false);
  });

  it('refetches on reload() and keeps the latest response', async () => {
    const { load, queue } = queuedLoad();
    const { result } = renderScoped({ scopeKey: 'k', empty: 'EMPTY', load });
    await flush();
    await act(async () => {
      queue[0].resolve('FIRST');
    });
    expect(result.current.data).toBe('FIRST');

    await act(async () => {
      result.current.reload();
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => {
      queue[0].resolve('OLD-FIRST'); // late response from the first fetch
    });
    await act(async () => {
      queue[1].resolve('SECOND');
    });
    expect(result.current.data).toBe('SECOND');
    expect(result.current.loading).toBe(false);
  });

  it('gates patch() appends via isKeyCurrent so stale key patches never leak', async () => {
    const { load, queue } = queuedLoad();
    const { result, rerender } = renderScoped({ scopeKey: 'a', empty: '', load });
    await flush();
    await act(async () => {
      queue[0].resolve('base');
    });

    // Current key: appends are visible.
    act(() => {
      result.current.patch((prev) => `${prev}+live`);
    });
    expect(result.current.data).toBe('base+live');

    // Switch key; a stale-key patch (a real SSE handler does this guarded by
    // isKeyCurrent) must not show up for the new unbound key.
    rerender({ scopeKey: 'b', empty: '', load });
    expect(result.current.data).toBe('');
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    const staleKey = 'a';
    act(() => {
      if (result.current.isKeyCurrent(staleKey)) {
        result.current.patch((prev) => `${prev}+leaked`);
      }
    });
    await act(async () => {
      queue[1].resolve('fresh-b');
    });
    expect(result.current.data).toBe('fresh-b');
    expect(result.current.loading).toBe(false);
  });

  it('lands on empty with loading false when load rejects', async () => {
    const { load, queue } = queuedLoad();
    const { result } = renderScoped({ scopeKey: 'a', empty: 'EMPTY', load });
    await flush();

    await act(async () => {
      queue[0].reject(new Error('boom'));
    });
    expect(result.current.data).toBe('EMPTY');
    expect(result.current.loading).toBe(false);

    // A rejection from an old key after switching must stay harmless.
    const second = queuedLoad();
    const { result: result2, rerender: rerender2 } = renderScoped({
      scopeKey: 'x',
      empty: 'EMPTY',
      load: second.load,
    });
    await flush();
    rerender2({ scopeKey: 'y', empty: 'EMPTY', load: second.load });
    await flush();
    await act(async () => {
      second.queue[0].reject(new Error('stale boom'));
    });
    expect(result2.current.data).toBe('EMPTY');
    expect(result2.current.loading).toBe(true);
    await act(async () => {
      second.queue[1].resolve('Y');
    });
    expect(result2.current.data).toBe('Y');
  });

  it('does not fetch when enabled is false and stops fetching when disabled mid-flight', async () => {
    const { load, queue } = queuedLoad();
    const { result, rerender } = renderScoped({
      scopeKey: 'a',
      empty: 'EMPTY',
      load,
      enabled: false,
    });
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(result.current.data).toBe('EMPTY');
    expect(result.current.loading).toBe(false);

    rerender({ scopeKey: 'a', empty: 'EMPTY', load, enabled: true });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);

    rerender({ scopeKey: 'a', empty: 'EMPTY', load, enabled: false });
    expect(result.current.loading).toBe(false);
    await act(async () => {
      queue[0].resolve('A');
    });
    // Disabling cancels the in-flight load, so no data lands while disabled.
    expect(result.current.data).toBe('EMPTY');

    rerender({ scopeKey: 'a', empty: 'EMPTY', load, enabled: true });
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => {
      queue[1].resolve('A');
    });
    expect(result.current.data).toBe('A');
  });

  it('clears data/loading for an empty scope key and on switching back to empty', async () => {
    const { load, queue } = queuedLoad();
    const { result, rerender } = renderScoped({ scopeKey: '', empty: 'EMPTY', load });
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(result.current.data).toBe('EMPTY');
    expect(result.current.loading).toBe(false);

    rerender({ scopeKey: 'a', empty: 'EMPTY', load });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);

    rerender({ scopeKey: '', empty: 'EMPTY', load });
    expect(result.current.data).toBe('EMPTY');
    expect(result.current.loading).toBe(false);
    await act(async () => {
      queue[0].resolve('LATE-A');
    });
    expect(result.current.data).toBe('EMPTY');
    expect(result.current.loading).toBe(false);
  });
});
