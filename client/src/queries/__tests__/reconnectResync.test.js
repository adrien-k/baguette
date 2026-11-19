// @vitest-environment jsdom
import { createElement } from 'react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from '../queryClient.js';
import {
  resetReconnectResyncForTests,
  resyncActiveQueriesFromServer,
  runAfterReconnectResync,
  scheduleReconnectResync,
} from '../reconnectResync.js';

describe('reconnectResync', () => {
  beforeEach(() => {
    resetReconnectResyncForTests();
  });

  afterEach(() => {
    resetReconnectResyncForTests();
  });

  it('reloads active queries from the server and drops rows the server no longer has', async () => {
    const client = createAppQueryClient();
    const key = ['tasks', 'list', 'resync'];
    let calls = 0;
    const queryFn = async () => {
      calls += 1;
      if (calls === 1) return [{ id: 1 }, { id: 9 }];
      return [{ id: 1 }, { id: 2 }];
    };
    const wrapper = ({ children }) => createElement(QueryClientProvider, { client }, children);
    const { unmount } = renderHook(() => useQuery({ queryKey: key, queryFn }), { wrapper });
    await waitFor(() => expect(client.getQueryData(key)).toEqual([{ id: 1 }, { id: 9 }]));

    await resyncActiveQueriesFromServer(client);

    expect(calls).toBe(2);
    expect(client.getQueryData(key)).toEqual([{ id: 1 }, { id: 2 }]);
    unmount();
  });

  it('applies events that arrive during the reload onto the server snapshot', async () => {
    const client = createAppQueryClient();
    const key = ['tasks', 'list', 'during-reload'];
    let calls = 0;
    let releaseReload;
    const reloadGate = new Promise((resolve) => {
      releaseReload = resolve;
    });
    const queryFn = async () => {
      calls += 1;
      if (calls === 1) return [{ id: 1 }];
      await reloadGate;
      return [{ id: 1 }, { id: 2 }];
    };
    const wrapper = ({ children }) => createElement(QueryClientProvider, { client }, children);
    const { unmount } = renderHook(() => useQuery({ queryKey: key, queryFn }), { wrapper });
    await waitFor(() => expect(calls).toBe(1));

    const pending = resyncActiveQueriesFromServer(client);
    await waitFor(() => expect(calls).toBe(2));
    runAfterReconnectResync(() => {
      client.setQueryData(key, (rows) => [...rows, { id: 3 }]);
    });
    expect(client.getQueryData(key)).toEqual([{ id: 1 }]);

    releaseReload();
    await pending;
    expect(client.getQueryData(key)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    unmount();
  });

  it('collapses repeated reconnects into one reload', async () => {
    vi.useFakeTimers();
    const client = createAppQueryClient();
    const calls = [];
    client.invalidateQueries = () => {
      calls.push('invalidate');
      return Promise.resolve();
    };

    scheduleReconnectResync(client);
    scheduleReconnectResync(client);
    await vi.advanceTimersByTimeAsync(249);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(calls).toEqual(['invalidate']);
    vi.useRealTimers();
  });

  it('keeps events queued when a newer reload supersedes an in-flight one', async () => {
    const client = createAppQueryClient();
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let releaseSecond;
    const secondGate = new Promise((resolve) => {
      releaseSecond = resolve;
    });
    let invalidations = 0;
    client.invalidateQueries = () => {
      invalidations += 1;
      if (invalidations === 1) return firstGate;
      return secondGate;
    };

    const first = resyncActiveQueriesFromServer(client);
    runAfterReconnectResync(() => {
      client.setQueryData(['tasks', 'held'], [{ id: 4 }]);
    });
    expect(client.getQueryData(['tasks', 'held'])).toBeUndefined();

    const second = resyncActiveQueriesFromServer(client);
    releaseFirst();
    await first;
    expect(client.getQueryData(['tasks', 'held'])).toBeUndefined();
    releaseSecond();
    await second;
    expect(client.getQueryData(['tasks', 'held'])).toEqual([{ id: 4 }]);
  });
});
