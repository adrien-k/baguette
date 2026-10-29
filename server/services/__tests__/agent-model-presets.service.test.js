import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerAgentModelPresetsService } from '../feathers/agent-model-presets.service.js';
import { ensureTestMockConfig } from '../../test-utils/agent-configs.js';

const db = createTestDb();

function makeApp() {
  const app = feathers();
  app.set('db', db);
  registerAgentModelPresetsService(app);
  return app;
}

const params = (user) => ({ provider: 'rest', user });

describe('agent-model-presets service', () => {
  let app;
  let userId;
  let otherUserId;
  let configId;

  beforeEach(async () => {
    app = makeApp();
    await app.setup();
    await db('users').insert([
      { github_id: 1, username: 'preset-a', approved: true },
      { github_id: 2, username: 'preset-b', approved: true },
    ]);
    userId = (await db('users').where({ username: 'preset-a' }).first()).id;
    otherUserId = (await db('users').where({ username: 'preset-b' }).first()).id;
    configId = await ensureTestMockConfig(db, userId);
  });

  it('creates and lists presets for the owner', async () => {
    const created = await app.service('agent-model-presets').create(
      {
        description: 'Fast todos',
        agent_config_id: configId,
        model: 'mock-standard',
      },
      params({ id: userId })
    );
    expect(created.description).toBe('Fast todos');
    expect(created.agent_sdk).toBe('mock');

    const { data } = await app.service('agent-model-presets').find(params({ id: userId }));
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(created.id);
  });

  it('does not list another user presets', async () => {
    await app.service('agent-model-presets').create(
      {
        description: 'Private',
        agent_config_id: configId,
        model: 'mock-standard',
      },
      params({ id: userId })
    );
    const { data } = await app.service('agent-model-presets').find(params({ id: otherUserId }));
    expect(data).toHaveLength(0);
  });

  it('rejects config not owned by the user', async () => {
    const otherConfigId = await ensureTestMockConfig(db, otherUserId);
    await expect(
      app.service('agent-model-presets').create(
        {
          description: 'Stolen config',
          agent_config_id: otherConfigId,
          model: 'mock-standard',
        },
        params({ id: userId })
      )
    ).rejects.toThrow(/not found/i);
  });

  it('patches a preset for the owner', async () => {
    const created = await app.service('agent-model-presets').create(
      {
        description: 'Before',
        agent_config_id: configId,
        model: 'mock-standard',
      },
      params({ id: userId })
    );
    const updated = await app
      .service('agent-model-presets')
      .patch(created.id, { description: 'After' }, params({ id: userId }));
    expect(updated.description).toBe('After');
    expect(updated.model).toBe('mock-standard');
  });

  it('does not patch another user preset', async () => {
    const created = await app.service('agent-model-presets').create(
      {
        description: 'Mine',
        agent_config_id: configId,
        model: 'mock-standard',
      },
      params({ id: userId })
    );
    await expect(
      app
        .service('agent-model-presets')
        .patch(created.id, { description: 'Hacked' }, params({ id: otherUserId }))
    ).rejects.toThrow(/not found/i);
  });
});
