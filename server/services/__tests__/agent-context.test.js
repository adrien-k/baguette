import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';
import { AGENT_CONFIG_DELETED_MESSAGE } from '../agent-config-deleted.js';
import { loadOwnedAgentConfigDecrypted, userRowForAgentSdk } from '../agent-context.js';

describe('userRowForAgentSdk', () => {
  it('does not read credential columns from the user row', () => {
    const user = userRowForAgentSdk({
      id: 1,
      pi_api_key_encrypted: 'enc:pi-secret',
      pi_api_key_env_var: 'OPENAI_API_KEY',
      agent_preferences: '{"theme":1}',
    });
    expect(user).toEqual({ id: 1, agent_preferences: '{"theme":1}' });
  });
});

describe('loadOwnedAgentConfigDecrypted', () => {
  const db = createTestDb({ beforeEach, afterEach });
  let owner;
  let configId;

  beforeEach(async () => {
    await db('users').insert({ github_id: 1, username: 'owner', approved: true });
    owner = await db('users').where({ username: 'owner' }).first();
    configId = await insertTestAgentConfig(db, owner.id, { apiKey: 'sk-ant-owner' });
  });

  it('loads config fields for an owned agent config', async () => {
    const config = await loadOwnedAgentConfigDecrypted(configId, owner.id, db);
    expect(config.api_key).toBe('sk-ant-owner');
    expect(config.sdk).toBe('claude');
  });

  it("does not decrypt another user's agent config", async () => {
    await db('users').insert({ github_id: 2, username: 'attacker', approved: true });
    const attacker = await db('users').where({ username: 'attacker' }).first();
    await expect(loadOwnedAgentConfigDecrypted(configId, attacker.id, db)).rejects.toThrow(
      'Agent configuration not found'
    );
  });

  it('returns null without throwing when the session has no config', async () => {
    expect(await loadOwnedAgentConfigDecrypted(null, owner.id, db)).toBeNull();
  });

  it('rejects a soft-deleted agent configuration', async () => {
    await db('agent_configs')
      .where({ id: configId })
      .update({ deleted_at: new Date().toISOString() });
    await expect(loadOwnedAgentConfigDecrypted(configId, owner.id, db)).rejects.toMatchObject({
      name: 'BadRequest',
      message: AGENT_CONFIG_DELETED_MESSAGE,
    });
  });
});
