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

  const getDescription = vi.fn(() => {
    const d = deferred();
    getDescription.queue.push(d);
    return d.promise;
  });
  getDescription.queue = [];

  return { getDescription };
});

vi.mock('../../feathers.js', () => ({
  sessionsService: { getDescription: mocks.getDescription },
}));

import { useSessionDescription } from '../useSessionDescription.js';

beforeEach(() => {
  mocks.getDescription.mockClear();
  mocks.getDescription.queue.length = 0;
});

afterEach(cleanup);

async function flush() {
  await act(async () => {});
}

describe('useSessionDescription', () => {
  it('loads the description projection for any signed-in viewer', async () => {
    const { result } = renderHook((id) => useSessionDescription(id), { initialProps: 41 });
    expect(result.current.loading).toBe(true);

    await flush();
    expect(mocks.getDescription).toHaveBeenCalledWith(41);

    await act(async () => {
      mocks.getDescription.queue[0].resolve({ id: 41, pr_description: 'body', images: [] });
    });
    expect(result.current.description).toEqual({ id: 41, pr_description: 'body', images: [] });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('passes the id through as-is so non-numeric route params reach the service', async () => {
    renderHook((id) => useSessionDescription(id), { initialProps: '41' });
    await flush();
    expect(mocks.getDescription).toHaveBeenCalledWith('41');
  });

  it('reports the error instead of a description when the load fails', async () => {
    const { result } = renderHook((id) => useSessionDescription(id), { initialProps: 41 });
    await flush();
    const boom = new Error('Session not found');
    await act(async () => {
      mocks.getDescription.queue[0].reject(boom);
    });
    expect(result.current.description).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(boom);
  });

  it('resets state and refetches when switching to another session', async () => {
    const { result, rerender } = renderHook((id) => useSessionDescription(id), {
      initialProps: 41,
    });
    await flush();
    await act(async () => {
      mocks.getDescription.queue[0].resolve({ id: 41, pr_description: 'first', images: [] });
    });
    expect(result.current.description.pr_description).toBe('first');

    rerender(42);
    expect(result.current.description).toBeNull();
    expect(result.current.loading).toBe(true);
    await flush();
    expect(mocks.getDescription).toHaveBeenLastCalledWith(42);

    // Stale response for the previous session must be ignored
    await act(async () => {
      mocks.getDescription.queue[0].resolve({ id: 41, pr_description: 'stale', images: [] });
    });
    expect(result.current.description).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      mocks.getDescription.queue[1].resolve({ id: 42, pr_description: 'second', images: [] });
    });
    expect(result.current.description.pr_description).toBe('second');
    expect(result.current.loading).toBe(false);
  });

  it('does nothing for a missing id', async () => {
    renderHook((id) => useSessionDescription(id), { initialProps: null });
    await flush();
    expect(mocks.getDescription).not.toHaveBeenCalled();
  });
});
