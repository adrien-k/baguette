import {
  DEFAULT_PI_API_KEY_ENV_VAR,
  normalizePiApiKeyEnvVar,
  PI_API_KEY_ENV_VARS,
} from './pi-api-key-env-vars.js';

/** @typedef {'claude' | 'cursor' | 'pi' | 'mock'} AgentConfigSdk */

export const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY';
export const ANTHROPIC_AUTH_TOKEN_ENV = 'ANTHROPIC_AUTH_TOKEN';
export const CURSOR_API_KEY_ENV = 'CURSOR_API_KEY';

/**
 * Split an agent_config api_key into Claude gateway auth fields by env var.
 * @param {object | null | undefined} config — decrypted agent_config shape
 */
export function claudeGatewayFields(config) {
  const isAuthToken = config?.api_key_env_var === ANTHROPIC_AUTH_TOKEN_ENV;
  return {
    apiKey: isAuthToken ? null : config?.api_key || null,
    authToken: isAuthToken ? config?.api_key || null : null,
    baseUrl: config?.api_url || null,
  };
}

export const CLAUDE_API_KEY_ENV_OPTIONS = [
  { value: ANTHROPIC_API_KEY_ENV, label: 'API key' },
  { value: ANTHROPIC_AUTH_TOKEN_ENV, label: 'Auth token' },
];

/**
 * Normalize api_key_env_var for storage on agent_configs.
 * Cursor always stores null; Claude and Pi require a valid env var name.
 * @param {AgentConfigSdk} sdk
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function normalizeAgentConfigApiKeyEnvVar(sdk, value) {
  if (sdk === 'cursor' || sdk === 'mock') return null;
  if (sdk === 'claude') {
    const v = String(value ?? '').trim();
    if (v === ANTHROPIC_API_KEY_ENV || v === ANTHROPIC_AUTH_TOKEN_ENV) return v;
    throw new Error(
      `Claude configurations must use ${ANTHROPIC_API_KEY_ENV} or ${ANTHROPIC_AUTH_TOKEN_ENV}`
    );
  }
  if (sdk === 'pi') {
    return normalizePiApiKeyEnvVar(value ?? DEFAULT_PI_API_KEY_ENV_VAR);
  }
  throw new Error(`Unknown agent config sdk "${sdk}"`);
}

/** Default env var when creating a config (null for Cursor). */
export function defaultAgentConfigApiKeyEnvVar(sdk) {
  if (sdk === 'cursor' || sdk === 'mock') return null;
  if (sdk === 'pi') return DEFAULT_PI_API_KEY_ENV_VAR;
  return ANTHROPIC_API_KEY_ENV;
}

export { PI_API_KEY_ENV_VARS };
