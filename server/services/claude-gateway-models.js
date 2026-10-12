import * as cache from '../lib/cache.js';
import { listAnthropicApiModels } from '../lib/anthropic-api/models.js';
import { anthropicApiAuthHeaders } from '../lib/anthropic-api/client.js';
import { listModels, modelsCacheKey } from './anthropic-models.js';
import { buildClaudeEnvFromPlainUser, normalizeAnthropicBaseUrl } from './session-env.js';
import { claudeGatewayFields } from '../../shared/agent-config-api-key-env.js';

/** Subprocess env for Claude Agent SDK calls using an agent_configs row. */
function claudeSubprocessEnvFromAgentConfig(config, userRow = null) {
  const { apiKey, authToken, baseUrl } = claudeGatewayFields(config);
  return buildClaudeEnvFromPlainUser(userRow, apiKey, baseUrl, {
    anthropicAuthToken: authToken,
  });
}

const GATEWAY_MODELS_CACHE_TTL = 60 * 60; // 1 hour

/**
 * Auth headers for direct calls to an Anthropic-API-compatible gateway:
 * Bearer for auth-token credentials, x-api-key for Console API keys.
 */
export function gatewayAuthHeaders({ apiKey, authToken } = {}) {
  return anthropicApiAuthHeaders({ apiKey, authToken });
}

/** A gateway is configured when a Claude API base URL is set (agent_config fields). */
export function gatewayDiscoveryActive(config) {
  return Boolean(normalizeAnthropicBaseUrl(config?.api_url));
}

/**
 * Single entry point for the Claude model list. When a Claude API base URL is configured,
 * the gateway itself is authoritative — list what its /v1/models endpoint serves (no
 * fallback: the SDK's built-in list would offer models the gateway cannot route). Without
 * a base URL there is no gateway to query, so the SDK's built-in list applies.
 * Cached per API URL; throws on gateway failure — callers must surface the error.
 */
/**
 * @returns {Promise<{ models: object[], rejected_models: { id: string, message: string }[] }>}
 */
export async function listClaudeModels(config, { refresh = false, user = null } = {}) {
  if (gatewayDiscoveryActive(config)) {
    const models = await listGatewayModels(config, { refresh });
    return { models, rejected_models: [] };
  }
  const claudeEnv = claudeSubprocessEnvFromAgentConfig(config, user);
  return listModels(config.baseUrl ?? null, { refresh, claudeEnv, probeAccess: refresh });
}

/**
 * List models from the gateway's /v1/models endpoint (Anthropic-API-compatible).
 * Cached per API URL; throws on failure — callers must surface the error (no fallback
 * to the built-in SDK list, which would show models the gateway cannot serve).
 */
export async function listGatewayModels(config, { refresh = false } = {}) {
  const base = normalizeAnthropicBaseUrl(config.api_url);
  if (!base) throw new Error('Gateway model discovery requires a Claude API base URL');
  const cacheKey = modelsCacheKey(base);
  if (refresh) await cache.clear(cacheKey);
  return cache.fetch(cacheKey, GATEWAY_MODELS_CACHE_TTL, async () =>
    listAnthropicApiModels({ ...claudeGatewayFields(config), baseUrl: base }, { limit: 100 })
  );
}
