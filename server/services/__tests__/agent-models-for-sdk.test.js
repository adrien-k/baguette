import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listModelsForAgentConfig } from '../agent-models-for-sdk.js';
import {
  MOCK_ALT_PRIMARY_MODEL_ID,
  MOCK_CATALOG_ALT_API_KEY,
  MOCK_STANDARD_MODEL_ID,
} from '../../../shared/mock-agent-sdk.js';

describe('listModelsForAgentConfig', () => {
  beforeEach(() => {
    vi.stubEnv('ENABLE_MOCK_AGENT', 'true');
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
});
