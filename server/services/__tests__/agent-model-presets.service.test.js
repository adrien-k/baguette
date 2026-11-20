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
      { github_id: 1, username: 'preset-a', status: 'approved' },
      { github_id: 2, username: 'preset-b', status: 'approved' },
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
    expect(created.enabled).toBe(true);
    expect(created.for_subagents).toBe(true);
    expect(created.for_new_sessions).toBe(true);

    const { data } = await app.service('agent-model-presets').find(params({ id: userId }));
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(created.id);
  });

  it('creates presets with explicit flag values', async () => {
    const created = await app.service('agent-model-presets').create(
      {
        description: 'Subagents only',
        agent_config_id: configId,
        model: 'mock-standard',
        enabled: true,
        for_subagents: true,
        for_new_sessions: false,
      },
      params({ id: userId })
    );
    expect(created.for_new_sessions).toBe(false);
    expect(created.for_subagents).toBe(true);
  });

  it('rejects invalid flag values on create and patch', async () => {
    await expect(
      app.service('agent-model-presets').create(
        {
          description: 'Bad flag',
          agent_config_id: configId,
          model: 'mock-standard',
          enabled: 'yes',
        },
        params({ id: userId })
      )
    ).rejects.toThrow(/enabled must be a boolean/);

    const created = await app.service('agent-model-presets').create(
      {
        description: 'Good flag',
        agent_config_id: configId,
        model: 'mock-standard',
      },
      params({ id: userId })
    );
    await expect(
      app
        .service('agent-model-presets')
        .patch(created.id, { for_subagents: 'nope' }, params({ id: userId }))
    ).rejects.toThrow(/for_subagents must be a boolean/);
  });

  it('toggles flags by patch', async () => {
    const created = await app.service('agent-model-presets').create(
      {
        description: 'Toggle me',
        agent_config_id: configId,
        model: 'mock-standard',
      },
      params({ id: userId })
    );
    const turnedOff = await app
      .service('agent-model-presets')
      .patch(created.id, { enabled: false, for_subagents: false }, params({ id: userId }));
    expect(turnedOff.enabled).toBe(false);
    expect(turnedOff.for_subagents).toBe(false);
    expect(turnedOff.for_new_sessions).toBe(true);

    const filtered = await app
      .service('agent-model-presets')
      .find({ ...params({ id: userId }), query: { enabled: 1 } });
    expect(filtered.data).toHaveLength(0);

    const turnedOn = await app
      .service('agent-model-presets')
      .patch(created.id, { enabled: true }, params({ id: userId }));
    expect(turnedOn.enabled).toBe(true);
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
    expect(updated.enabled).toBe(true);
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
