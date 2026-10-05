import * as cache from '../lib/cache.js';
import { listModels, modelsCacheKey } from './anthropic-models.js';
import { normalizeAnthropicBaseUrl } from './session-env.js';

const GATEWAY_MODELS_CACHE_TTL = 60 * 60; // 1 hour

/**
 * Auth headers for direct calls to an Anthropic-API-compatible gateway:
 * Bearer for auth-token credentials, x-api-key for Console API keys.
 */
export function gatewayAuthHeaders({ apiKey, authToken } = {}) {
  const headers = { 'anthropic-version': '2023-06-01' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  else if (apiKey) headers['x-api-key'] = apiKey;
  return headers;
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
  return cache.fetch(cacheKey, GATEWAY_MODELS_CACHE_TTL, async () => {
    const res = await fetch(`${base}/v1/models?limit=100`, {
      headers: gatewayAuthHeaders(config),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gateway model list failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const data = Array.isArray(json?.data) ? json.data : [];
    const models = data
      .map((m) => ({
        id: m.id ?? m.name,
        display_name: m.display_name ?? m.name ?? m.id,
        description: null,
      }))
      .filter((m) => typeof m.id === 'string' && m.id);
    if (!models.length) throw new Error('Gateway returned no models');
    return models;
  });
}
