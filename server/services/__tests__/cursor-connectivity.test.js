import { describe, it, expect, vi, beforeEach } from 'vitest';

const modelsList = vi.hoisted(() => vi.fn());
vi.mock('@cursor/sdk', () => ({
  Cursor: { models: { list: modelsList } },
}));

import { runCursorConnectivityTest } from '../cursor-connectivity.js';

beforeEach(() => {
  modelsList.mockReset();
});

describe('runCursorConnectivityTest', () => {
  it('fails with a clear message when no key is configured', async () => {
    const result = await runCursorConnectivityTest({ sdk: 'cursor', api_key: null });
    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ id: 'auth', ok: false });
    expect(result.checks[0].detail).toMatch(/No Cursor API key configured/);
  });

  it('passes when the SDK lists models and reports the count', async () => {
    modelsList.mockResolvedValue([
      { id: 'gpt-5', displayName: 'GPT-5' },
      { id: '', displayName: 'empty ignored' },
      { id: 'composer-1', displayName: 'Composer' },
    ]);
    const result = await runCursorConnectivityTest({ sdk: 'cursor', api_key: 'cursor-key' });
    expect(modelsList).toHaveBeenCalledWith({ apiKey: 'cursor-key' });
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['gpt-5', 'composer-1']);
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
    expect(byId.auth.ok).toBe(true);
    expect(byId.models.detail).toBe('2 models available');
  });

  it('reports SDK errors (e.g. invalid key) as an auth failure', async () => {
    modelsList.mockRejectedValue(new Error('Unauthorized: invalid API key'));
    const result = await runCursorConnectivityTest({ sdk: 'cursor', api_key: 'bad-key' });
    expect(result.ok).toBe(false);
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
    expect(byId.auth.ok).toBe(false);
    expect(byId.auth.detail).toBe('Unauthorized: invalid API key');
  });

  it('reports timeouts as an auth failure', async () => {
    modelsList.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 60_000)));
    vi.useFakeTimers();
    const promise = runCursorConnectivityTest({ sdk: 'cursor', api_key: 'cursor-key' });
    await vi.advanceTimersByTimeAsync(21_000);
    const result = await promise;
    vi.useRealTimers();
    expect(result.ok).toBe(false);
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
    expect(byId.auth.detail).toMatch(/Timed out after 20s/);
  });
});
