import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createAppQueryClient } from '../queryClient.js';
import {
  notifySseStreamPaused,
  resetSseReconnectStateForTests,
  runSseResumeCatchUp,
} from '../../utils/sseReconnect.js';

function feathersError(code) {
  return { code, name: 'BadRequest', message: 'bad request' };
}

describe('createAppQueryClient', () => {
  beforeEach(() => {
    resetSseReconnectStateForTests();
  });

  afterEach(() => {
    resetSseReconnectStateForTests();
  });

  it('does not retry 4xx feathers errors', () => {
    const client = createAppQueryClient();
    const { retry } = client.getDefaultOptions().queries;
    expect(retry).toBeTypeOf('function');
    expect(retry(1, feathersError(404))).toBe(false);
    expect(retry(1, feathersError(400))).toBe(false);
    expect(retry(1, feathersError(401))).toBe(false);
  });

  it('retries 5xx feathers errors up to the max', () => {
    const client = createAppQueryClient();
    const { retry } = client.getDefaultOptions().queries;
    expect(retry(1, feathersError(500))).toBe(true);
    expect(retry(3, feathersError(500))).toBe(false);
  });

  it('retries unknown errors up to the max', () => {
    const client = createAppQueryClient();
    const { retry } = client.getDefaultOptions().queries;
    expect(retry(1, new Error('network down'))).toBe(true);
    expect(retry(3, new Error('network down'))).toBe(false);
  });

  it('refetches on window focus and reconnect by default', async () => {
    const client = createAppQueryClient();
    const { refetchOnWindowFocus, refetchOnReconnect, staleTime } =
      client.getDefaultOptions().queries;
    expect(refetchOnWindowFocus).toBeTypeOf('function');
    expect(refetchOnWindowFocus()).toBe(true);
    notifySseStreamPaused();
    expect(refetchOnWindowFocus()).toBe(false);
    await runSseResumeCatchUp();
    expect(refetchOnWindowFocus()).toBe(true);
    expect(refetchOnReconnect).toBe(true);
    expect(staleTime).toBeGreaterThan(0);
  });

  it('refetchActiveQueriesOnSseReconnect refetches with cancelRefetch false', async () => {
    const client = createAppQueryClient();
    const refetched = [];
    const original = client.refetchQueries.bind(client);
    client.refetchQueries = (filters, options) => {
      refetched.push({ filters, options });
      return original(filters, options);
    };
    const { refetchActiveQueriesOnSseReconnect } = await import('../queryClient.js');
    refetchActiveQueriesOnSseReconnect(client);
    expect(refetched).toEqual([{ filters: { type: 'active' }, options: { cancelRefetch: false } }]);
  });

  it('refetchActiveQueriesForResumeCatchUp cancels in-flight fetches', async () => {
    const client = createAppQueryClient();
    const calls = [];
    const original = client.refetchQueries.bind(client);
    client.refetchQueries = (filters, options) => {
      calls.push({ filters, options });
      return original(filters, options);
    };
    const { refetchActiveQueriesForResumeCatchUp } = await import('../queryClient.js');
    void refetchActiveQueriesForResumeCatchUp(client);
    expect(calls).toEqual([{ filters: { type: 'active' }, options: { cancelRefetch: true } }]);
  });
});
