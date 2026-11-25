import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  clearAntigravityModelsCache,
  listAntigravityModels,
  mapAcpSessionModels,
} from '../models.js';

describe('antigravity models', () => {
  beforeEach(async () => {
    await clearAntigravityModelsCache({ api_key: 'k1' });
  });

  it('mapAcpSessionModels builds thought-level variants and picks current default', () => {
    const models = mapAcpSessionModels({
      sessionId: 'sess-1',
      configOptions: [
        {
          id: 'model',
          category: 'model',
          type: 'select',
          options: [
            { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', description: 'Fast model' },
            { value: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
          ],
        },
      ],
      models: {
        currentModelId: 'gemini-3.8-flash-low',
        availableModels: [
          { modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
          { modelId: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
          { modelId: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
        ],
      },
    });

    expect(models).toEqual([
      {
        id: 'gemini-3.8-flash',
        display_name: 'Gemini 3.8 Flash',
        description: 'Fast model',
        variants: [
          {
            display_name: 'Gemini 3.8 Flash (Low)',
            description: null,
            is_default: true,
            params: [{ id: 'reasoning', value: 'low' }],
          },
          {
            display_name: 'Gemini 3.8 Flash (Medium)',
            description: null,
            is_default: false,
            params: [{ id: 'reasoning', value: 'medium' }],
          },
          {
            display_name: 'Gemini 3.8 Flash (High)',
            description: null,
            is_default: false,
            params: [{ id: 'reasoning', value: 'high' }],
          },
        ],
      },
      {
        id: 'gemini-3.1-pro',
        display_name: 'Gemini 3.1 Pro',
        description: null,
        variants: null,
      },
    ]);
  });

  it('mapAcpSessionModels falls back to availableModels when configOptions are absent', () => {
    const models = mapAcpSessionModels({
      models: {
        availableModels: [{ modelId: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
      },
    });
    expect(models).toEqual([
      {
        id: 'gemini-3.8-flash',
        display_name: 'Gemini 3.8 Flash',
        description: null,
        variants: null,
      },
    ]);
  });

  it('listAntigravityModels caches catalog and supports refresh', async () => {
    const newSession = vi.fn().mockResolvedValue({
      sessionId: 'ephemeral-1',
      models: {
        availableModels: [{ modelId: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
      },
    });
    const fakeClient = {
      initialize: vi.fn().mockResolvedValue({}),
      authenticate: vi.fn().mockResolvedValue(undefined),
      newSession,
      closeSession: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const spawnClient = vi.fn(() => fakeClient);

    const first = await listAntigravityModels({ api_key: 'k1' }, { spawnClient });
    const second = await listAntigravityModels({ api_key: 'k1' }, { spawnClient });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(spawnClient).toHaveBeenCalledTimes(1);

    await listAntigravityModels({ api_key: 'k1' }, { refresh: true, spawnClient });
    expect(spawnClient).toHaveBeenCalledTimes(2);
    expect(fakeClient.closeSession).toHaveBeenCalledWith('ephemeral-1');
    expect(fakeClient.close).toHaveBeenCalledTimes(2);
  });
});
