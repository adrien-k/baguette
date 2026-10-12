import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/pi-provider-model-probe.js', () => ({
  probePiProviderModelCatalog: vi.fn(),
}));

vi.mock('../pi-models.js', () => ({
  createPiModelRuntime: vi.fn(async () => ({
    getProvider: () => undefined,
  })),
}));

import { probePiProviderModelCatalog } from '../../lib/pi-provider-model-probe.js';
import { runPiConnectivityTest } from '../pi-connectivity.js';

describe('runPiConnectivityTest', () => {
  beforeEach(() => {
    vi.mocked(probePiProviderModelCatalog).mockReset();
  });

  it('rejects a fake Anthropic API key', async () => {
    const err = new Error('invalid x-api-key');
    err.status = 401;
    vi.mocked(probePiProviderModelCatalog).mockRejectedValue(err);

    const result = await runPiConnectivityTest({
      sdk: 'pi',
      api_key: 'sk-ant-api03-totally-invalid-key',
      api_key_env_var: 'ANTHROPIC_API_KEY',
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'auth', ok: false })])
    );
    expect(probePiProviderModelCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-ant-api03-totally-invalid-key',
        envVar: 'ANTHROPIC_API_KEY',
        providerId: 'anthropic',
      })
    );
  });

  it('rejects a fake LunaRoute API key', async () => {
    const err = new Error('Invalid or revoked API key');
    err.status = 401;
    vi.mocked(probePiProviderModelCatalog).mockRejectedValue(err);

    const result = await runPiConnectivityTest({
      sdk: 'pi',
      api_key: 'lr_totally_fake',
      api_key_env_var: 'LUNAROUTE_API_KEY',
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'auth', ok: false })])
    );
  });

  it('reports success when the probe returns models', async () => {
    vi.mocked(probePiProviderModelCatalog).mockResolvedValue({ modelCount: 1 });

    const result = await runPiConnectivityTest({
      sdk: 'pi',
      api_key: 'lr_ok',
      api_key_env_var: 'LUNAROUTE_API_KEY',
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'auth', ok: true }),
        expect.objectContaining({ id: 'models', ok: true, detail: '1 model(s) available' }),
      ])
    );
  });
});
