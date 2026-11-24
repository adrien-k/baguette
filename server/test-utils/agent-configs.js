import { encrypt } from '../lib/encrypt.js';
import { accountAgentConfigLabel } from '../../shared/agent-config-labels.js';
import {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_AUTH_TOKEN_ENV,
} from '../../shared/agent-config-api-key-env.js';
import { DEFAULT_PI_API_KEY_ENV_VAR } from '../../shared/pi-api-key-env-vars.js';

function defaultTestApiKeyEnvVar(sdk, apiKey, apiKeyEnvVar) {
  if (apiKeyEnvVar !== undefined) return apiKeyEnvVar;
  if (sdk === 'cursor' || sdk === 'mock' || sdk === 'antigravity') return null;
  if (apiKey?.startsWith('tok')) return ANTHROPIC_AUTH_TOKEN_ENV;
  if (sdk === 'pi') return DEFAULT_PI_API_KEY_ENV_VAR;
  return ANTHROPIC_API_KEY_ENV;
}

/**
 * Insert a test agent_configs row (credentials for Claude/Cursor/Pi/Antigravity in migrated schema).
 */
export async function insertTestAgentConfig(
  db,
  userId,
  {
    sdk = 'claude',
    label = null,
    apiKey = 'sk-ant-test-key',
    apiKeyEnvVar = undefined,
    apiUrl = null,
  } = {}
) {
  const envVar = defaultTestApiKeyEnvVar(sdk, apiKey, apiKeyEnvVar);
  const [id] = await db('agent_configs').insert({
    user_id: userId,
    label: label ?? accountAgentConfigLabel(sdk),
    sdk,
    api_url: apiUrl,
    api_key_encrypted: apiKey ? encrypt(apiKey) : null,
    api_key_env_var: envVar,
    extra_env_json: null,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return id;
}

/** Default claude config id for a user in tests. */
export async function ensureTestClaudeConfig(db, userId, apiKey = 'sk-ant-test-key') {
  const existing = await db('agent_configs')
    .where({ user_id: userId, sdk: 'claude', api_key_env_var: ANTHROPIC_API_KEY_ENV })
    .whereNull('deleted_at')
    .first();
  if (existing) return existing.id;
  return insertTestAgentConfig(db, userId, { sdk: 'claude', apiKey });
}

/** Default pi config id for a user in tests. */
export async function ensureTestPiConfig(db, userId, apiKey = 'pi-test-key') {
  const existing = await db('agent_configs')
    .where({ user_id: userId, sdk: 'pi' })
    .whereNull('deleted_at')
    .first();
  if (existing) return existing.id;
  return insertTestAgentConfig(db, userId, { sdk: 'pi', apiKey });
}

/** Mock config when ENABLE_MOCK_AGENT is set (tests / e2e). */
export async function ensureTestMockConfig(db, userId) {
  const { ensureMockAgentConfig } = await import('../agent-sdks/mock/mock-agent-config.js');
  const id = await ensureMockAgentConfig(db, userId);
  if (!id) {
    return insertTestAgentConfig(db, userId, {
      sdk: 'mock',
      apiKey: null,
      apiKeyEnvVar: null,
      label: 'Mock',
    });
  }
  return id;
}
