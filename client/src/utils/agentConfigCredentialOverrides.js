/**
 * Unsaved credential fields for test connection / list models (merged server-side).
 * Branch on plugin `credentialSchema`, not sdk keys.
 * @param {object} opts
 * @param {string} opts.sdk
 * @param {{ hasApiUrl?: boolean, envVarOptions?: Array<{ value: string }> | null, defaultEnvVar?: string | null } | null | undefined} opts.schema
 * @param {object | null | undefined} opts.savedConfig
 * @param {string} opts.apiUrl
 * @param {string | null} opts.apiKey
 * @param {boolean} opts.apiKeyDirty
 * @param {string} opts.apiKeyEnvVar
 */
export function buildAgentConfigCredentialOverrides({
  schema,
  savedConfig,
  apiUrl,
  apiKey,
  apiKeyDirty,
  apiKeyEnvVar,
}) {
  const fields = {};

  if (schema?.hasApiUrl) {
    const savedUrl = savedConfig?.api_url ?? '';
    if (String(apiUrl ?? '').trim() !== String(savedUrl).trim()) {
      fields.api_url = String(apiUrl ?? '').trim();
    }
  }

  if (apiKeyDirty) {
    fields.api_key = apiKey ?? '';
    if (schema?.envVarOptions?.length && apiKeyEnvVar) {
      fields.api_key_env_var = apiKeyEnvVar;
    }
  }

  if (schema?.envVarOptions?.length) {
    const savedEnv = savedConfig?.api_key_env_var ?? schema.defaultEnvVar;
    if (apiKeyEnvVar !== savedEnv) {
      fields.api_key_env_var = apiKeyEnvVar;
    }
  }

  return fields;
}

/** Request body for agent-configs.testConnectivity (saved row or draft from the form). */
export function buildAgentConfigConnectivityRequest({
  sdk,
  schema,
  savedConfig,
  apiUrl,
  apiKey,
  apiKeyDirty,
  apiKeyEnvVar,
  agentConfigId,
}) {
  const overrides = buildAgentConfigCredentialOverrides({
    schema,
    savedConfig,
    apiUrl,
    apiKey,
    apiKeyDirty,
    apiKeyEnvVar,
  });
  const trimmedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (trimmedKey) {
    overrides.api_key = trimmedKey;
  }
  if (schema?.envVarOptions?.length && apiKeyEnvVar) {
    overrides.api_key_env_var = apiKeyEnvVar;
  }
  if (agentConfigId != null) {
    return { id: agentConfigId, ...overrides };
  }
  return { sdk, ...overrides };
}
