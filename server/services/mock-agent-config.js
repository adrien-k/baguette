import { isMockAgentSdkEnabled } from '../../shared/mock-agent-sdk.js';
import { accountAgentConfigLabel } from '../../shared/agent-config-labels.js';

/** Ensure a Mock agent_configs row exists when the mock agent server is enabled. */
export async function ensureMockAgentConfig(db, userId) {
  if (!isMockAgentSdkEnabled()) return null;
  const existing = await db('agent_configs').where({ user_id: userId, sdk: 'mock' }).first();
  if (existing) return existing.id;
  const [id] = await db('agent_configs').insert({
    user_id: userId,
    label: accountAgentConfigLabel('mock'),
    sdk: 'mock',
    api_url: null,
    api_key_encrypted: null,
    api_key_env_var: null,
    extra_env_json: null,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return id;
}
