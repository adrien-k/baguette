import {
  DEFAULT_PI_API_KEY_ENV_VAR,
  normalizePiApiKeyEnvVar,
  piProviderIdForEnvVar,
} from '../../../shared/pi-api-key-env-vars.js';

/**
 * Effective Pi API key and env var from an agent_configs row (decrypted).
 * @param {object | null | undefined} config — agent_config shape (api_key plaintext)
 */
export function resolvePiCredentials(config) {
  const rawEnvVar =
    config?.api_key_env_var != null && config.api_key_env_var !== ''
      ? config.api_key_env_var
      : DEFAULT_PI_API_KEY_ENV_VAR;
  let envVar = DEFAULT_PI_API_KEY_ENV_VAR;
  try {
    envVar = normalizePiApiKeyEnvVar(rawEnvVar) ?? DEFAULT_PI_API_KEY_ENV_VAR;
  } catch {
    /* fall through to the default env var */
  }
  return {
    apiKey: config?.api_key || null,
    envVar,
    providerId: piProviderIdForEnvVar(envVar),
  };
}
