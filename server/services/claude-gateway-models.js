import * as cache from '../lib/cache.js';
import { listAnthropicApiModels } from '../lib/anthropic-api/models.js';
import { anthropicApiAuthHeaders } from '../lib/anthropic-api/client.js';
import { listModels, modelsCacheKey } from './anthropic-models.js';
import { normalizeAnthropicBaseUrl } from './session-env.js';

const GATEWAY_MODELS_CACHE_TTL = 60 * 60; // 1 hour

/**
 * Auth headers for direct calls to an Anthropic-API-compatible gateway:
 * Bearer for auth-token credentials, x-api-key for Console API keys.
 */
export function gatewayAuthHeaders({ apiKey, authToken } = {}) {
  return anthropicApiAuthHeaders({ apiKey, authToken });
}

/** Effective Claude gateway config (repo overrides account) from plaintext rows. */
export function resolveClaudeGatewayConfig(user, repo = null) {
  return {
    apiKey: repo?.anthropic_api_key || user?.anthropic_api_key || null,
    authToken: repo?.anthropic_auth_token || user?.anthropic_auth_token || null,
    baseUrl: repo?.anthropic_base_url ?? user?.anthropic_base_url ?? null,
  };
}

/** A gateway is configured when a Claude API base URL is set. */
export function gatewayDiscoveryActive(config) {
  return Boolean(normalizeAnthropicBaseUrl(config.baseUrl));
}

/**
 * Single entry point for the Claude model list. When a Claude API base URL is configured,
 * the gateway itself is authoritative — list what its /v1/models endpoint serves (no
 * fallback: the SDK's built-in list would offer models the gateway cannot route). Without
 * a base URL there is no gateway to query, so the SDK's built-in list applies.
 * Cached per API URL; throws on gateway failure — callers must surface the error.
 */
export async function listClaudeModels(config, options = {}) {
  if (gatewayDiscoveryActive(config)) {
    return listGatewayModels(config, options);
  }
  return listModels(config.baseUrl ?? null, options);
}

/**
 * List models from the gateway's /v1/models endpoint (Anthropic-API-compatible).
 * Cached per API URL; throws on failure — callers must surface the error (no fallback
 * to the built-in SDK list, which would show models the gateway cannot serve).
 */
export async function listGatewayModels(config, { refresh = false } = {}) {
  const base = normalizeAnthropicBaseUrl(config.baseUrl);
  if (!base) throw new Error('Gateway model discovery requires a Claude API base URL');
  const cacheKey = modelsCacheKey(base);
  if (refresh) await cache.clear(cacheKey);
  return cache.fetch(cacheKey, GATEWAY_MODELS_CACHE_TTL, async () =>
    listAnthropicApiModels(
      {
        baseUrl: base,
        apiKey: config.apiKey,
        authToken: config.authToken,
      },
      { limit: 100 }
    )
  );
}
