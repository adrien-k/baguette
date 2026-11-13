import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listModelsForAgentConfig } from '../agent-models-for-sdk.js';
import {
  MOCK_ALT_PRIMARY_MODEL_ID,
  MOCK_CATALOG_ALT_API_KEY,
  MOCK_STANDARD_MODEL_ID,
} from '../../../shared/mock-agent-sdk.js';

const listCursorModels = vi.fn();
const refreshCursorModels = vi.fn();

vi.mock('../../agent-sdks/cursor/models.js', () => ({
  listCursorModels: (...args) => listCursorModels(...args),
  refreshCursorModels: (...args) => refreshCursorModels(...args),
}));

describe('listModelsForAgentConfig', () => {
  beforeEach(async () => {
    vi.stubEnv('ENABLE_MOCK_AGENT', 'true');
    const { registerAllSdkPlugins } = await import('../../agent-sdks/index.js');
    registerAllSdkPlugins();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists mock models without an API key on the config row', async () => {
    const { models } = await listModelsForAgentConfig('mock', { sdk: 'mock', api_key: null });
    expect(models.some((m) => m.id === MOCK_STANDARD_MODEL_ID)).toBe(true);
  });

  it('lists alternate mock catalog when catalog key is set', async () => {
    const { models } = await listModelsForAgentConfig('mock', {
      sdk: 'mock',
      api_key: MOCK_CATALOG_ALT_API_KEY,
    });
    expect(models.some((m) => m.id === MOCK_ALT_PRIMARY_MODEL_ID)).toBe(true);
    expect(models.some((m) => m.id === MOCK_STANDARD_MODEL_ID)).toBe(false);
  });

  it('awaits async Cursor model list (not a Promise in models)', async () => {
    listCursorModels.mockResolvedValue([{ id: 'composer-2', display_name: 'Composer 2' }]);
    const { models } = await listModelsForAgentConfig('cursor', {
      sdk: 'cursor',
      api_key: 'test-key',
    });
    expect(listCursorModels).toHaveBeenCalledWith('test-key');
    expect(Array.isArray(models)).toBe(true);
    expect(models).toEqual([{ id: 'composer-2', display_name: 'Composer 2' }]);
  });
});
