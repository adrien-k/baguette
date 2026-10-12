import { describe, it, expect, vi } from 'vitest';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import {
  createPiModelRuntime,
  resolvePiSessionModel,
  seedLunaroutePiOAuthCredential,
} from '../pi-models.js';

describe('pi-models', () => {
  it('stores LunaRoute keys as OAuth credentials for the lunaroute provider', async () => {
    const store = new InMemoryCredentialStore();
    await seedLunaroutePiOAuthCredential(store, 'lr_test_key');
    const cred = await store.read('lunaroute');
    expect(cred).toMatchObject({ type: 'oauth', access: 'lr_test_key' });
  });

  it('createPiModelRuntime marks lunaroute auth as stored', async () => {
    const runtime = await createPiModelRuntime('lr_test_key', 'LUNAROUTE_API_KEY');
    expect(runtime.getProviderAuthStatus('lunaroute')).toEqual({
      configured: true,
      source: 'stored',
    });
  });

  it('resolvePiSessionModel surfaces LunaRoute gateway auth errors', async () => {
    const runtime = {
      refresh: vi.fn().mockResolvedValue({}),
      getModels: () => [],
    };
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'bad key' } }),
    }));

    const result = await resolvePiSessionModel(runtime, 'glm-5.3-flash', 'LUNAROUTE_API_KEY', {
      apiKey: 'lr_bad',
      config: null,
      fetchImpl,
    });
    expect(result.error).toMatch(/bad key/);
  });
});
