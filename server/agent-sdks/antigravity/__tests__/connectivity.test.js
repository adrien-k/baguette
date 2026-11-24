import { describe, it, expect, vi } from 'vitest';
import { runAntigravityConnectivityTest } from '../connectivity.js';

describe('runAntigravityConnectivityTest', () => {
  it('returns ok=true with auth and model checks when session opens cleanly', async () => {
    const fakeClient = {
      initialize: vi.fn().mockResolvedValue({
        agentInfo: { name: 'Antigravity', version: '1.5.14' },
      }),
      authenticate: vi.fn(),
      newSession: vi.fn().mockResolvedValue({
        sessionId: 'sess-1',
        configOptions: [
          {
            id: 'model',
            category: 'model',
            type: 'select',
            options: [{ value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
          },
        ],
        models: {
          availableModels: [{ modelId: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' }],
        },
      }),
      closeSession: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runAntigravityConnectivityTest(null, {
      spawnClient: () => fakeClient,
    });

    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['gemini-3.8-flash']);
    expect(result.checks).toEqual([
      expect.objectContaining({ id: 'cli', ok: true, detail: 'Antigravity v1.5.14' }),
      expect.objectContaining({ id: 'auth', ok: true, detail: 'Using local agy credentials' }),
      expect.objectContaining({ id: 'models', ok: true, detail: '1 model available' }),
    ]);
    expect(fakeClient.closeSession).toHaveBeenCalledWith('sess-1');
    expect(fakeClient.close).toHaveBeenCalled();
  });

  it('reports CLI ENOENT clearly', async () => {
    const enoent = Object.assign(new Error('spawn agy ENOENT'), { code: 'ENOENT' });
    const fakeClient = {
      initialize: vi.fn().mockRejectedValue(enoent),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runAntigravityConnectivityTest({}, { spawnClient: () => fakeClient });
    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ id: 'cli', ok: false });
    expect(result.checks[0].detail).toContain('not found');
  });

  it('reports auth failure when -32000 is returned without API key and authenticates when key is set', async () => {
    const authErr = Object.assign(new Error('Authentication required'), { code: -32000 });
    const unauthClient = {
      initialize: vi.fn().mockResolvedValue({ agentInfo: { name: 'agy' } }),
      newSession: vi.fn().mockRejectedValue(authErr),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const unauthRes = await runAntigravityConnectivityTest(null, {
      spawnClient: () => unauthClient,
    });
    expect(unauthRes.ok).toBe(false);
    expect(unauthRes.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'auth', ok: false })])
    );

    const apiKeyClient = {
      initialize: vi.fn().mockResolvedValue({ agentInfo: { name: 'agy' } }),
      authenticate: vi.fn().mockResolvedValue(undefined),
      newSession: vi
        .fn()
        .mockRejectedValueOnce(authErr)
        .mockResolvedValueOnce({
          sessionId: 'sess-auth',
          models: { availableModels: [{ modelId: 'gemini-3.8-flash' }] },
        }),
      closeSession: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const keyRes = await runAntigravityConnectivityTest(
      { api_key: 'gm-key' },
      { spawnClient: () => apiKeyClient }
    );
    expect(apiKeyClient.authenticate).toHaveBeenCalledWith('gemini-api-key');
    expect(keyRes.ok).toBe(true);
    expect(keyRes.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'auth', ok: true, detail: 'Using Gemini API key' }),
      ])
    );
  });
});
