import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb, testSessionAgentDefaults } from '../../test-utils/db.js';
import { registerAgentConfigsService } from '../feathers/agent-configs.service.js';

const db = createTestDb({ beforeEach, afterEach });
const params = (user) => ({ provider: 'rest', user });

function makeApp() {
  const app = feathers();
  app.set('db', db);
  registerAgentConfigsService(app);
  return app;
}

let app;
let user1;

beforeEach(async () => {
  await db('users').insert({ github_id: 1, username: 'alice', approved: true });
  user1 = await db('users').where({ username: 'alice' }).first();
  app = makeApp();
  await app.setup();
});

describe('agent-configs external format', () => {
  it('reports api_key_configured on find after decrypt strips api_key_encrypted', async () => {
    const created = await app
      .service('agent-configs')
      .create({ label: 'Keyed', sdk: 'claude', api_key: 'sk-ant-secret-key' }, params(user1));
    const listed = await app.service('agent-configs').find(params(user1));
    const row = listed.data.find((c) => c.id === created.id);
    expect(row.api_key_configured).toBe(true);
    expect(row.api_key).toBeTruthy();
    expect(row.api_key).not.toBe('sk-ant-secret-key');
    expect(row.api_key_encrypted).toBeUndefined();
  });

  it('api_key_configured is false when no key is stored', async () => {
    const created = await app
      .service('agent-configs')
      .create({ label: 'NoKey', sdk: 'claude' }, params(user1));
    const external = await app.service('agent-configs').get(created.id, params(user1));
    expect(external.api_key_configured).toBe(false);
    expect(external.api_key).toBeNull();
  });
});

describe('agent-configs logo', () => {
  it('stores and returns logo', async () => {
    const created = await app
      .service('agent-configs')
      .create({ label: 'OR', sdk: 'claude', logo: 'OpenRouter' }, params(user1));
    expect(created.logo).toBe('OpenRouter');
    const row = await db('agent_configs').where({ id: created.id }).first();
    expect(row.logo).toBe('OpenRouter');
  });

  it('rejects invalid logo', async () => {
    await expect(
      app
        .service('agent-configs')
        .create({ label: 'Bad', sdk: 'claude', logo: 'not-a-logo' }, params(user1))
    ).rejects.toMatchObject({ name: 'BadRequest' });
  });
});

describe('agent-configs default_model', () => {
  it('stores JSON and returns a parsed object', async () => {
    const created = await app.service('agent-configs').create(
      {
        label: 'GW',
        sdk: 'claude',
        api_key: 'sk-ant-test',
        default_model: { model: 'sonnet', model_params: [{ id: 'fast', value: 'true' }] },
      },
      params(user1)
    );
    const row = await db('agent_configs').where({ id: created.id }).first();
    expect(JSON.parse(row.default_model)).toEqual({
      model: 'sonnet',
      model_params: [{ id: 'fast', value: 'true' }],
    });
    const external = await app.service('agent-configs').get(created.id, params(user1));
    expect(external.default_model).toEqual({
      model: 'sonnet',
      model_params: [{ id: 'fast', value: 'true' }],
    });
  });

  it('clears default_model when patched to null', async () => {
    const created = await app
      .service('agent-configs')
      .create({ label: 'A', sdk: 'claude', default_model: { model: 'opus' } }, params(user1));
    const updated = await app
      .service('agent-configs')
      .patch(created.id, { default_model: null }, params(user1));
    expect(updated.default_model).toEqual({ model: null, model_params: null });
    const row = await db('agent_configs').where({ id: created.id }).first();
    expect(row.default_model).toBeNull();
  });
});

describe('agent-configs remove', () => {
  it('removes when nothing references the configuration', async () => {
    const spare = await app
      .service('agent-configs')
      .create({ label: 'Keep', sdk: 'claude' }, params(user1));
    const doomed = await app
      .service('agent-configs')
      .create({ label: 'Gone', sdk: 'claude' }, params(user1));
    await app.service('agent-configs').remove(doomed.id, params(user1));
    await expect(app.service('agent-configs').get(doomed.id, params(user1))).rejects.toMatchObject({
      name: 'NotFound',
    });
    await expect(app.service('agent-configs').get(spare.id, params(user1))).resolves.toBeTruthy();
  });

  it('rejects remove with Conflict when references exist', async () => {
    const doomed = await app
      .service('agent-configs')
      .create({ label: 'Gone', sdk: 'claude' }, params(user1));
    await db('users').where({ id: user1.id }).update({ agent_default_config_id: doomed.id });
    await expect(
      app.service('agent-configs').remove(doomed.id, params(user1))
    ).rejects.toMatchObject({
      name: 'Conflict',
      data: { code: 'agent_config_in_use' },
    });
  });

  it('removeWithReplacement migrates references then deletes', async () => {
    const replacement = await app
      .service('agent-configs')
      .create({ label: 'Keep', sdk: 'claude', default_model: { model: 'opus' } }, params(user1));
    const doomed = await app
      .service('agent-configs')
      .create({ label: 'Gone', sdk: 'claude' }, params(user1));
    await db('users').where({ id: user1.id }).update({
      agent_default_config_id: doomed.id,
      reviewer_default_config_id: doomed.id,
    });
    const [repoId] = await db('repos').insert({
      full_name: 'test/agent-config-delete',
      default_branch: 'main',
      repo_path: 'test/agent-config-delete',
    });
    const [sessId] = await db('sessions').insert({
      user_id: user1.id,
      repo_id: repoId,
      repo_full_name: 'test/agent-config-delete',
      base_branch: 'main',
      initial_prompt: 'x',
      short_id: 'delcfg01',
      status: 'active',
      session_path: '/tmp/delcfg',
      agent_config_id: doomed.id,
      review_agent_config_id: doomed.id,
      ...testSessionAgentDefaults,
    });
    await app.service('agent-configs').removeWithReplacement(
      {
        id: doomed.id,
        builder_replacement: {
          agent_config_id: replacement.id,
          model: 'opus',
          model_params: null,
        },
        reviewer_replacement: {
          agent_config_id: replacement.id,
          model: 'opus',
          model_params: null,
        },
      },
      params(user1)
    );
    const session = await db('sessions').where({ id: sessId }).first();
    expect(session.agent_config_id).toBe(replacement.id);
    expect(session.model).toBe('opus');
    expect(session.review_agent_config_id).toBe(replacement.id);
    expect(session.review_model).toBe('opus');
    const user = await db('users').where({ id: user1.id }).first();
    expect(user.agent_default_config_id).toBe(replacement.id);
    expect(user.reviewer_default_config_id).toBe(replacement.id);
    await expect(app.service('agent-configs').get(doomed.id, params(user1))).rejects.toMatchObject({
      name: 'NotFound',
    });
  });
});
