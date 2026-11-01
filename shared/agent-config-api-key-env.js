import { PI_API_KEY_ENV_VARS } from './pi-api-key-env-vars.js';

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
 * Env var names allowed by a plugin credential schema.
 * @param {{ envVarOptions?: Array<{ value?: string, env?: string }> | null } | null | undefined} schema
 * @returns {string[]}
 */
function allowedEnvVars(schema) {
  return (schema?.envVarOptions ?? []).map((o) => o.value ?? o.env).filter(Boolean);
}

/**
 * Normalize api_key_env_var for storage on agent_configs from a plugin credential schema.
 * SDKs with `envVarOptions: null` / `defaultEnvVar: null` always store null.
 * @param {{ envVarOptions?: Array<{ value?: string, env?: string }> | null, defaultEnvVar?: string | null } | null | undefined} schema
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function normalizeAgentConfigApiKeyEnvVar(schema, value) {
  if (!schema || schema.envVarOptions == null || schema.defaultEnvVar == null) return null;
  const allowed = allowedEnvVars(schema);
  if (!allowed.length) return null;
  const v = String(value ?? '').trim() || schema.defaultEnvVar;
  if (!allowed.includes(v)) {
    throw new Error(`Invalid API key env var "${v}". Use: ${allowed.join(', ')}`);
  }
  return v;
}

/** Default env var when creating a config (`null` when the schema has no default). */
export function defaultAgentConfigApiKeyEnvVar(schema) {
  return schema?.defaultEnvVar ?? null;
}

export { PI_API_KEY_ENV_VARS };
