import { describe, expect, it } from 'vitest';
import { createAppQueryClient } from '../queryClient.js';

function feathersError(code) {
  return { code, name: 'BadRequest', message: 'bad request' };
}

describe('createAppQueryClient', () => {
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

  it('refetches on window focus and reconnect by default', () => {
    const client = createAppQueryClient();
    const { refetchOnWindowFocus, refetchOnReconnect, staleTime } =
      client.getDefaultOptions().queries;
    expect(refetchOnWindowFocus).toBe(true);
    expect(refetchOnReconnect).toBe(true);
    expect(staleTime).toBeGreaterThan(0);
  });

  it('refetchActiveQueriesOnSseReconnect refetches only stale active queries', async () => {
    const client = createAppQueryClient();
    const refetched = [];
    const original = client.refetchQueries.bind(client);
    client.refetchQueries = (filters, options) => {
      refetched.push(filters);
      return original(filters, options);
    };
    const { refetchActiveQueriesOnSseReconnect } = await import('../queryClient.js');
    refetchActiveQueriesOnSseReconnect(client);
    expect(refetched).toEqual([{ type: 'active', stale: true }]);
  });
});
