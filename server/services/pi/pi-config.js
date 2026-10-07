import {
  DEFAULT_PI_API_KEY_ENV_VAR,
  effectivePiApiKeyEnvVar,
  piProviderIdForEnvVar,
} from '../../../shared/pi-api-key-env-vars.js';

/** Effective Pi API key and env var (repo overrides account). */
export function resolvePiCredentials(user, repo = null) {
  return {
    apiKey: repo?.pi_api_key || user?.pi_api_key || null,
    envVar: effectivePiApiKeyEnvVar(user, repo),
    providerId: piProviderIdForEnvVar(
      repo?.pi_api_key_env_var ?? user?.pi_api_key_env_var ?? DEFAULT_PI_API_KEY_ENV_VAR
    ),
  };
}
