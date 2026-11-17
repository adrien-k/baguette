import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';
import { registerAgentConfigsService } from '../feathers/agent-configs.service.js';
import { getUtilityModelService, resolveUtilityModelDefaults } from '../utility-model.js';

const db = createTestDb();

function makeApp() {
  const app = feathers();
  app.set('db', db);
  registerAgentConfigsService(app);
  app.use('pi-agent', { async get() {} }, { methods: ['get'] });
  app.service('agent-configs').registerSdk({
    key: 'pi',
    label: 'Pi',
    service_path: 'pi-agent',
  });
  return app;
}

describe('utility model defaults', () => {
  let app;
  let userId;
  let piConfigId;
  let claudeConfigId;

  beforeEach(async () => {
    app = makeApp();
    await db('users').insert({ github_id: 1, username: 'utility-user', status: 'approved' });
    const user = await db('users').where({ username: 'utility-user' }).first();
    userId = user.id;
    claudeConfigId = await insertTestAgentConfig(db, userId, { apiKey: 'sk-ant' });
    piConfigId = await insertTestAgentConfig(db, userId, { sdk: 'pi', apiKey: 'pi-key' });
  });

  it('returns null when no utility default is set', async () => {
    expect(await resolveUtilityModelDefaults(db, userId)).toBeNull();
    expect(await getUtilityModelService(app, userId)).toBeNull();
  });

  it('returns null for unknown users', async () => {
    expect(await resolveUtilityModelDefaults(db, 99999)).toBeNull();
  });

  it('resolves the stored utility config and model', async () => {
    await db('users')
      .where({ id: userId })
      .update({
        utility_default_config_id: piConfigId,
        utility_default_model: JSON.stringify({
          model: 'opencode-go/glm-5.3-flash',
          model_params: [{ id: 'fast', value: 'true' }],
        }),
      });

    const resolved = await resolveUtilityModelDefaults(db, userId);
    expect(resolved).toEqual({
      agent_config_id: piConfigId,
      agent_sdk: 'pi',
      model: 'opencode-go/glm-5.3-flash',
      model_params: [{ id: 'fast', value: 'true' }],
    });
  });

  it('falls back to the config default_model when the stored model is empty', async () => {
    await db('agent_configs')
      .where({ id: piConfigId })
      .update({
        default_model: JSON.stringify({ model: 'pi-cheap', model_params: null }),
      });
    await db('users').where({ id: userId }).update({
      utility_default_config_id: piConfigId,
      utility_default_model: null,
    });

    const resolved = await resolveUtilityModelDefaults(db, userId);
    expect(resolved.model).toBe('pi-cheap');
  });

  it('ignores configs owned by another user', async () => {
    await db('users').insert({ github_id: 2, username: 'other', status: 'approved' });
    const otherUser = await db('users').where({ username: 'other' }).first();
    const foreignConfigId = await insertTestAgentConfig(db, otherUser.id, {
      sdk: 'claude',
      label: 'Other Claude',
      apiKey: 'sk-ant',
    });
    await db('users').where({ id: userId }).update({
      utility_default_config_id: foreignConfigId,
    });
    expect(await resolveUtilityModelDefaults(db, userId)).toBeNull();
  });

  it('getUtilityModelService routes to the utility config SDK service', async () => {
    await db('users')
      .where({ id: userId })
      .update({
        utility_default_config_id: piConfigId,
        utility_default_model: JSON.stringify({ model: 'opencode-go/glm-5.3-flash' }),
      });

    const resolved = await getUtilityModelService(app, userId);
    expect(resolved.service).toBe(app.service('pi-agent'));
    expect(resolved.agent_config_id).toBe(piConfigId);
    expect(resolved.agent_sdk).toBe('pi');
    expect(resolved.model).toBe('opencode-go/glm-5.3-flash');
  });

  it('getUtilityModelService rejects unregistered SDKs', async () => {
    await db('users').where({ id: userId }).update({
      utility_default_config_id: claudeConfigId,
    });
    await expect(getUtilityModelService(app, userId)).rejects.toThrow(
      /Agent SDK "claude" is not registered/
    );
  });
});
