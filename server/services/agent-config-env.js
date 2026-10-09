import { decrypt } from '../lib/encrypt.js';

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
