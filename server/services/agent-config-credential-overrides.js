import { defaultAgentConfigApiKeyEnvVar } from '../../shared/agent-config-api-key-env.js';

const CONFIG_COLUMN_OVERRIDE_KEYS = ['api_url', 'api_key', 'api_key_env_var'];

/**
 * Credential overrides for test/listModels (config column names only).
 * @param {Record<string, unknown>} fields
 * @returns {Record<string, string>}
 */
export function credentialOverridesFromQuery(fields = {}) {
  const overrides = {};
  for (const key of CONFIG_COLUMN_OVERRIDE_KEYS) {
    const value = fields[key];
    if (value !== undefined && value !== null && value !== '') {
      overrides[key] = String(value);
    }
  }
  return overrides;
}

/** Same as credentialOverridesFromQuery; use for POST bodies (testConnectivity, listModels). */
const credentialOverridesFromPayload = credentialOverridesFromQuery;

function truthyRefresh(value) {
  return value === true || value === 'true' || value === '1';
}

/**
 * Parse agent-configs.listModels inputs. Credential overrides come from the POST body only.
 * @param {unknown} data
 * @param {Record<string, unknown>} [query]
 */
export function resolveListModelsRequest(data, query = {}) {
  const body = { ...(data?.payload ?? data ?? {}) };
  const id = body.id ?? body.agent_config_id ?? query.id ?? query.agent_config_id;
  const sdk = body.sdk ?? query.sdk;
  const refresh = truthyRefresh(body.refresh) || truthyRefresh(query.refresh);
  const credentialOverrides = credentialOverridesFromPayload(body);
  return { id, sdk, refresh, credentialOverrides };
}

/**
 * Apply test/listModels credential overrides onto a decrypted agent_configs row.
 * @param {object} config
 * @param {Record<string, string>} overrides
 */
export function applyCredentialOverridesToConfig(config, overrides) {
  if (!overrides || !Object.keys(overrides).length) return config;
  const next = { ...config };
  if (overrides.api_url !== undefined) {
    next.api_url = overrides.api_url || null;
  }
  if (overrides.api_key !== undefined) {
    next.api_key = overrides.api_key || null;
  }
  if (overrides.api_key_env_var !== undefined) {
    next.api_key_env_var = overrides.api_key_env_var || null;
  }
  return next;
}

/**
 * Ephemeral agent_configs shape for connectivity tests before the row is saved.
 * @param {string} sdk
 * @param {Record<string, string>} overrides
 */
export function draftAgentConfigForConnectivityTest(sdk, overrides = {}) {
  const base = {
    sdk,
    api_url: null,
    api_key: null,
    api_key_env_var:
      sdk === 'cursor' || sdk === 'mock' ? null : defaultAgentConfigApiKeyEnvVar(sdk),
  };
  return applyCredentialOverridesToConfig(base, overrides);
}
