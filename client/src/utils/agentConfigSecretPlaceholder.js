import { LUNAROUTE_PI_API_KEY_ENV_VAR } from '@baguette/shared/pi-api-key-env-vars.js';

/**
 * Placeholder for the agent config API key field (Settings → Agent).
 * @param {string} sdk
 * @param {string | null | undefined} apiKeyEnvVar
 */
export function agentConfigSecretPlaceholder(sdk, apiKeyEnvVar) {
  if (sdk === 'cursor') return 'cursor-…';
  if (sdk === 'pi') {
    if (apiKeyEnvVar === LUNAROUTE_PI_API_KEY_ENV_VAR) return 'lr_…';
    return 'provider API key';
  }
  return 'sk-ant-…';
}
