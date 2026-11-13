import { describe, it, expect, vi, beforeEach } from 'vitest';

const listSdkPlugins = vi.hoisted(() => vi.fn());
const registerAllSdkPlugins = vi.hoisted(() => vi.fn());

vi.mock('../registry.js', () => ({
  listSdkPlugins,
}));

vi.mock('../index.js', () => ({
  registerAllSdkPlugins,
}));

const { ensureBuiltInSdkPluginsRegistered } = await import('../ensure-builtins-registered.js');

describe('ensureBuiltInSdkPluginsRegistered', () => {
  beforeEach(() => {
    listSdkPlugins.mockReset();
    registerAllSdkPlugins.mockReset();
    listSdkPlugins.mockReturnValue([]);
  });

  it('retries after a failed manifest register', async () => {
    registerAllSdkPlugins.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    await expect(ensureBuiltInSdkPluginsRegistered()).rejects.toThrow('boom');
    await expect(ensureBuiltInSdkPluginsRegistered()).resolves.toBeUndefined();
    expect(registerAllSdkPlugins).toHaveBeenCalledTimes(2);
  });
});
