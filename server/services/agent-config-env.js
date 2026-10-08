import { decrypt } from '../lib/encrypt.js';
import { normalizeAnthropicBaseUrl } from './session-env.js';
import {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_AUTH_TOKEN_ENV,
  CURSOR_API_KEY_ENV,
} from '../../shared/agent-config-api-key-env.js';

function parseExtraEnvJson(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    /* ignore */
  }
  return {};
}

/** DB row → decrypted config object for SDK helpers (api_key plaintext). */
export function decryptAgentConfigRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    label: row.label,
    sdk: row.sdk,
    api_url: row.api_url ?? null,
    api_key: row.api_key_encrypted ? decrypt(row.api_key_encrypted) : null,
    api_key_env_var: row.api_key_env_var ?? null,
    extra_env_json: row.extra_env_json ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Merge agent_config credentials into a subprocess env object.
 * Sets the env var named by api_key_env_var when api_key is present.
 */
export function applyAgentConfigToEnv(env, config) {
  let result = { ...env };
  if (!config) return result;
  if (config.api_key) {
    if (config.sdk === 'cursor') {
      result = { ...result, [CURSOR_API_KEY_ENV]: config.api_key };
    } else if (config.api_key_env_var) {
      result = { ...result, [config.api_key_env_var]: config.api_key };
    }
  }
  if (config.sdk === 'claude') {
    const normalized = normalizeAnthropicBaseUrl(config.api_url);
    if (normalized) result = { ...result, ANTHROPIC_BASE_URL: normalized };
  }
  const extra = parseExtraEnvJson(config.extra_env_json);
  for (const [key, value] of Object.entries(extra)) {
    if (value != null && value !== '') result[key] = String(value);
  }
  return result;
}

export function defaultApiKeyEnvVarForSdk(sdk, { isAuthToken = false } = {}) {
  if (sdk === 'cursor') return null;
  if (sdk === 'pi') return null;
  if (isAuthToken) return ANTHROPIC_AUTH_TOKEN_ENV;
  return ANTHROPIC_API_KEY_ENV;
}
