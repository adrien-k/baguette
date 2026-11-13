import { describe, it, expect, vi, beforeEach } from 'vitest';

const refresh = vi.fn().mockResolvedValue(undefined);
const getAvailableSnapshot = vi.fn().mockReturnValue([{ id: 'gpt-4o', displayName: 'GPT-4o' }]);
const setRuntimeApiKey = vi.fn().mockResolvedValue(undefined);

vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: {
    create: vi.fn().mockResolvedValue({
      refresh,
      getAvailableSnapshot,
      setRuntimeApiKey,
    }),
  },
  resolveCliModel: vi.fn(),
}));

const { listPiModels, clearPiModelsCache } = await import('../models.js');
const cache = await import('../../../lib/cache.js');

describe('listPiModels', () => {
  beforeEach(async () => {
    refresh.mockClear();
    getAvailableSnapshot.mockClear();
    await cache.clear('pi-models:OPENAI_API_KEY:sk-test1');
  });

  it('reloads the Pi catalog from the network on a cache miss', async () => {
    const models = await listPiModels('sk-test12345', 'OPENAI_API_KEY');
    expect(refresh).toHaveBeenCalledWith({ allowNetwork: true });
    expect(getAvailableSnapshot).toHaveBeenCalled();
    expect(models[0].id).toBe('gpt-4o');
  });

  it('force refresh clears the cache then reloads from the network', async () => {
    await listPiModels('sk-test12345', 'OPENAI_API_KEY');
    refresh.mockClear();
    getAvailableSnapshot.mockClear();

    await listPiModels('sk-test12345', 'OPENAI_API_KEY');
    expect(refresh).not.toHaveBeenCalled();

    await listPiModels('sk-test12345', 'OPENAI_API_KEY', { refresh: true });
    expect(refresh).toHaveBeenCalledWith({ allowNetwork: true });
  });

  it('clearPiModelsCache drops the catalog so the next list hits the network', async () => {
    await listPiModels('sk-test12345', 'OPENAI_API_KEY');
    refresh.mockClear();
    await clearPiModelsCache('sk-test12345', 'OPENAI_API_KEY');
    await listPiModels('sk-test12345', 'OPENAI_API_KEY');
    expect(refresh).toHaveBeenCalledWith({ allowNetwork: true });
  });
});
