import { query } from '@anthropic-ai/claude-agent-sdk';
import * as cache from '../lib/cache.js';

const MODELS_CACHE_KEY = 'anthropic-models';
const MODELS_CACHE_TTL = Infinity;

// Standard API models that may not appear in the agent SDK's supportedModels() list
const EXTRA_MODELS = [
  {
    id: 'claude-sonnet-4-6',
    display_name: 'Claude Sonnet 4.6 (200K)',
    description: '200K context window',
  },
];

export async function listModels() {
  return cache.fetch(MODELS_CACHE_KEY, MODELS_CACHE_TTL, async () => {
    const q = query({ prompt: '' });
    try {
      const sdkModels = await q.supportedModels();
      const models = sdkModels.map((m) => ({
        id: m.value,
        display_name: m.displayName,
        description: m.description,
      }));
      const modelIds = new Set(models.map((m) => m.id));
      for (const extra of EXTRA_MODELS) {
        if (!modelIds.has(extra.id)) models.push(extra);
      }
      return models;
    } finally {
      q.close();
    }
  });
}

export async function refreshModels() {
  await cache.clear(MODELS_CACHE_KEY);
  return listModels();
}
