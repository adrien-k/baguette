import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createAppQueryClient } from '../queryClient.js';
import { resetReconnectResyncForTests } from '../reconnectResync.js';

function feathersError(code) {
  return { code, name: 'BadRequest', message: 'bad request' };
}

describe('createAppQueryClient', () => {
  beforeEach(() => {
    resetReconnectResyncForTests();
  });

  afterEach(() => {
    resetReconnectResyncForTests();
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

  it('does not refetch on window focus or browser reconnect', () => {
    const client = createAppQueryClient();
    const { refetchOnWindowFocus, refetchOnReconnect, staleTime } =
      client.getDefaultOptions().queries;
    expect(refetchOnWindowFocus).toBe(false);
    expect(refetchOnReconnect).toBe(false);
    expect(staleTime).toBeGreaterThan(0);
  });
});
