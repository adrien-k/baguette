import { query } from '@anthropic-ai/claude-agent-sdk';
import * as cache from '../lib/cache.js';
import { normalizeAnthropicBaseUrl } from './session-env.js';

const DEFAULT_CLAUDE_API_URL = 'https://api.anthropic.com';
const MODELS_CACHE_TTL = Infinity;

/**
 * Claude model cache key, derived from the (normalized) Claude API URL so each endpoint
 * gets its own entries. Falls back to the default Anthropic endpoint when none is set.
 * The gateway and built-in SDK list paths share this key (only one path is active per
 * endpoint, so they never collide).
 */
export function modelsCacheKey(claudeApiUrl) {
  const base = normalizeAnthropicBaseUrl(claudeApiUrl) || DEFAULT_CLAUDE_API_URL;
  return `anthropic-models:${base}`;
}

/**
 * Models from the agent SDK's supportedModels() list (used when no Claude API base URL is
 * configured). The cache key is derived from the effective Claude API URL, so changing the
 * configured endpoint never serves a stale list. With `refresh`, the cached entry is
 * dropped first so the next fetch is fresh (the "Refresh from provider" action).
 */
export async function listModels(claudeApiUrl = null, { refresh = false } = {}) {
  if (refresh) await cache.clear(modelsCacheKey(claudeApiUrl));
  return cache.fetch(modelsCacheKey(claudeApiUrl), MODELS_CACHE_TTL, async () => {
    const q = query({ prompt: '' });
    try {
      const sdkModels = await q.supportedModels();
      return sdkModels.map((m) => ({
        id: m.value,
        display_name: m.displayName,
        description: m.description,
      }));
    } finally {
      q.close();
    }
  });
}
