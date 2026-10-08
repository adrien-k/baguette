import { defaultAgentConfigApiKeyEnvVar } from '@baguette/shared/agent-config-api-key-env.js';

/**
 * Unsaved credential fields for test connection / list models (merged server-side).
 * @param {object} opts
 * @param {string} opts.sdk
 * @param {object | null | undefined} opts.savedConfig
 * @param {string} opts.apiUrl
 * @param {string | null} opts.apiKey
 * @param {boolean} opts.apiKeyDirty
 * @param {string} opts.apiKeyEnvVar
 */
export function buildAgentConfigCredentialOverrides({
  sdk,
  savedConfig,
  apiUrl,
  apiKey,
  apiKeyDirty,
  apiKeyEnvVar,
}) {
  if (sdk === 'mock') return {};

  const fields = {};

  if (sdk === 'claude') {
    const savedUrl = savedConfig?.api_url ?? '';
    if (apiUrl.trim() !== String(savedUrl).trim()) {
      fields.api_url = apiUrl.trim();
    }
  }

  if (apiKeyDirty) {
    fields.api_key = apiKey ?? '';
    if (sdk === 'claude' && apiKeyEnvVar) {
      fields.api_key_env_var = apiKeyEnvVar;
    }
  }

  if (sdk === 'pi') {
    const savedPiEnv =
      savedConfig?.api_key_env_var ?? defaultAgentConfigApiKeyEnvVar(savedConfig?.sdk ?? 'pi');
    if (apiKeyEnvVar !== savedPiEnv) {
      fields.api_key_env_var = apiKeyEnvVar;
    }
  }

  return fields;
}

/** Request body for agent-configs.testConnectivity (saved row or draft from the form). */
export function buildAgentConfigConnectivityRequest({
  sdk,
  savedConfig,
  apiUrl,
  apiKey,
  apiKeyDirty,
  apiKeyEnvVar,
  agentConfigId,
}) {
  const overrides = buildAgentConfigCredentialOverrides({
    sdk,
    savedConfig,
    apiUrl,
    apiKey,
    apiKeyDirty,
    apiKeyEnvVar,
  });
  if (agentConfigId != null) {
    return { id: agentConfigId, ...overrides };
  }
  return { sdk, ...overrides };
}
