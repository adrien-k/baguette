import { query } from '@anthropic-ai/claude-agent-sdk';
import { claudeCodeModelDisplayName } from '../../shared/claude-code-model-display.js';
import { mapClaudeCodeSdkModelToListEntry } from '../../shared/claude-code-model-list.js';
import { attachClaudeModelVariants } from '../../shared/claude-model-variants.js';
import * as cache from '../lib/cache.js';
import { normalizeAnthropicBaseUrl } from './session-env.js';
import { partitionClaudeCodeModelsByAccess } from './claude-code-model-access.js';

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

function mapSdkModels(sdkModels) {
  const models = [];
  for (const row of sdkModels ?? []) {
    const entry = mapClaudeCodeSdkModelToListEntry(row, claudeCodeModelDisplayName);
    if (!entry) continue;
    models.push(
      attachClaudeModelVariants({
        ...entry,
        _claudeModelInfo: row,
      })
    );
  }
  return models;
}

/**
 * Models from the agent SDK's supportedModels() list (used when no Claude API base URL is
 * configured). The cache key is derived from the effective Claude API URL, so changing the
 * configured endpoint never serves a stale list. With `refresh`, the cached entry is
 * dropped first so the next fetch is fresh (the "Refresh from provider" action).
 *
 * @param {string | null} claudeApiUrl
 * @param {{ refresh?: boolean, claudeEnv?: Record<string, string> | null, probeAccess?: boolean }} [options]
 * @returns {Promise<{ models: object[], rejected_models: { id: string, message: string }[] }>}
 */
export async function listModels(
  claudeApiUrl = null,
  { refresh = false, claudeEnv = null, probeAccess = false } = {}
) {
  if (refresh) await cache.clear(modelsCacheKey(claudeApiUrl));
  return cache.fetch(modelsCacheKey(claudeApiUrl), MODELS_CACHE_TTL, async () => {
    const q = query({ prompt: '', ...(claudeEnv ? { options: { env: claudeEnv } } : {}) });
    try {
      const sdkModels = await q.supportedModels();
      let rows = sdkModels;
      let rejected = [];
      if (probeAccess && (claudeEnv?.ANTHROPIC_API_KEY || claudeEnv?.ANTHROPIC_AUTH_TOKEN)) {
        const partitioned = await partitionClaudeCodeModelsByAccess(sdkModels, claudeEnv);
        rows = partitioned.accessible;
        rejected = partitioned.rejected;
      }
      return { models: mapSdkModels(rows), rejected_models: rejected };
    } finally {
      q.close();
    }
  });
}
