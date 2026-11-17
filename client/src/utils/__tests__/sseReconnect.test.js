// @vitest-environment jsdom
import { createElement } from 'react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  consumeSkipSseReconnectRefetch,
  flushSseReconnectNotifyForTests,
  notifySseReconnect,
  notifySseStreamPaused,
  resetSseReconnectStateForTests,
  runSseResumeCatchUp,
  subscribeSseReconnect,
  subscribeSseResumeCatchUp,
  subscribeSseStreamPaused,
} from '../sseReconnect.js';

describe('sseReconnect', () => {
  beforeEach(() => {
    resetSseReconnectStateForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    flushSseReconnectNotifyForTests();
    resetSseReconnectStateForTests();
    vi.useRealTimers();
  });

  it('notifies subscribers on reconnect', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSseReconnect(listener);
    notifySseReconnect();
    vi.runAllTimers();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    notifySseReconnect();
    vi.runAllTimers();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid reconnect notifications', () => {
    const listener = vi.fn();
    subscribeSseReconnect(listener);
    notifySseReconnect();
    notifySseReconnect();
    notifySseReconnect();
    vi.runAllTimers();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates listener errors', () => {
    const good = vi.fn();
    subscribeSseReconnect(() => {
      throw new Error('boom');
    });
    subscribeSseReconnect(good);
    expect(() => {
      notifySseReconnect();
      vi.runAllTimers();
    }).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('notifies pause subscribers when the SSE stream is paused', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSseStreamPaused(listener);
    notifySseStreamPaused();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    notifySseStreamPaused();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('suppresses debounced reconnect refetch until resume catch-up is consumed', async () => {
    const onReconnect = vi.fn();
    subscribeSseReconnect(onReconnect);
    subscribeSseResumeCatchUp(() => Promise.resolve());
    await runSseResumeCatchUp();
    notifySseReconnect();
    vi.runAllTimers();
    expect(onReconnect).not.toHaveBeenCalled();
    expect(consumeSkipSseReconnectRefetch()).toBe(true);
    notifySseReconnect();
    vi.runAllTimers();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps an agent status written while the resume queryFn is in flight', async () => {
    vi.useRealTimers();
    const { createAppQueryClient, refetchActiveQueriesForResumeCatchUp } =
      await import('../../queries/queryClient.js');
    const client = createAppQueryClient();
    const key = ['sessions', 'detail', 1];
    let calls = 0;
    let releaseFetch;
    const fetchGate = new Promise((resolve) => {
      releaseFetch = resolve;
    });
    const queryFn = async () => {
      calls += 1;
      if (calls === 1) return { id: 1, agents: [{ id: 1, status: 'running' }] };
      await fetchGate;
      return { id: 1, agents: [{ id: 1, status: 'stopped' }] };
    };
    const wrapper = ({ children }) => createElement(QueryClientProvider, { client }, children);
    const { unmount } = renderHook(() => useQuery({ queryKey: key, queryFn, staleTime: 0 }), {
      wrapper,
    });
    await waitFor(() => expect(calls).toBe(1));

    const unsubscribe = subscribeSseResumeCatchUp(() =>
      refetchActiveQueriesForResumeCatchUp(client)
    );
    const catchUp = runSseResumeCatchUp();
    await waitFor(() => expect(calls).toBe(2));
    client.setQueryData(key, { id: 1, agents: [{ id: 1, status: 'approval' }] });
    releaseFetch();
    await catchUp;
    expect(client.getQueryData(key).agents[0].status).toBe('approval');
    unsubscribe();
    unmount();
  });

  it('does not apply a focus fetch started at the beginning of the resume delay', async () => {
    vi.useRealTimers();
    const { createAppQueryClient, refetchActiveQueriesForResumeCatchUp } =
      await import('../../queries/queryClient.js');
    const client = createAppQueryClient();
    const key = ['sessions', 'detail', 'focus-delay'];
    let releaseFocusFetch;
    const focusGate = new Promise((resolve) => {
      releaseFocusFetch = resolve;
    });
    let generation = 0;
    const queryFn = async () => {
      generation += 1;
      if (generation === 1) return 'initial';
      if (generation === 2) {
        await focusGate;
        return 'focus-body';
      }
      return 'catch-up-body';
    };
    const wrapper = ({ children }) => createElement(QueryClientProvider, { client }, children);
    const { unmount } = renderHook(() => useQuery({ queryKey: key, queryFn, staleTime: 0 }), {
      wrapper,
    });
    await waitFor(() => expect(client.getQueryData(key)).toBe('initial'));

    notifySseStreamPaused();
    expect(client.getDefaultOptions().queries.refetchOnWindowFocus()).toBe(false);

    const focusFetch = client.refetchQueries({ type: 'active' });
    await waitFor(() => expect(generation).toBe(2));

    const unsubscribe = subscribeSseResumeCatchUp(() =>
      refetchActiveQueriesForResumeCatchUp(client)
    );
    await runSseResumeCatchUp();
    expect(generation).toBeGreaterThan(2);
    expect(client.getQueryData(key)).toBe('catch-up-body');

    releaseFocusFetch();
    await focusFetch.catch(() => {});
    expect(client.getQueryData(key)).toBe('catch-up-body');
    unsubscribe();
    unmount();
  });

  it('awaits resume catch-up listeners before settling', async () => {
    const order = [];
    subscribeSseResumeCatchUp(async () => {
      order.push('catch-up-start');
      await Promise.resolve();
      order.push('catch-up-end');
    });
    await runSseResumeCatchUp();
    expect(order).toEqual(['catch-up-start', 'catch-up-end']);
  });
});
