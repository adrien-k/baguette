import { describe, it, expect, beforeEach, vi } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';
import { registerAgentConfigsService } from '../feathers/agent-configs.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';

const db = createTestDb();

const completeText = vi.fn().mockResolvedValue('Fix flaky login test.');

async function makeApp() {
  const app = feathers();
  app.set('db', db);
  registerAgentConfigsService(app);
  app.use('utility-agent', { completeText }, { methods: ['completeText'] });
  app.service('agent-configs').registerSdk({
    key: 'utility',
    label: 'Utility',
    service_path: 'utility-agent',
  });
  app.use(
    'sessions',
    {
      get: async (id) => {
        const row = await db('sessions')
          .where({ id: Number(id) })
          .first();
        return row ?? { id: Number(id) };
      },
    },
    { methods: ['get'] }
  );
  registerAgentsService(app);
  await app.setup();
  return app;
}

describe('agents create - secondary builder naming', () => {
  let app;
  let user;
  let utilityConfigId;
  let sessionId;

  const params = () => ({ provider: 'rest', user });

  beforeEach(async () => {
    vi.clearAllMocks();
    completeText.mockResolvedValue('Fix flaky login test.');
    app = await makeApp();
    await db('users').insert({ github_id: 1, username: 'naming-user', status: 'approved' });
    user = await db('users').where({ username: 'naming-user' }).first();
    utilityConfigId = await insertTestAgentConfig(db, user.id, {
      sdk: 'utility',
      apiKey: 'ut-key',
    });
    [sessionId] = await db('sessions').insert({
      user_id: user.id,
      repo_full_name: 'o/r',
      base_branch: 'main',
      short_id: 'abc12',
      initial_prompt: 'work',
      status: 'stopped',
    });
    await db('agents').insert({
      session_id: sessionId,
      ref: 1,
      name: 'Builder',
      agent_type: 'builder',
      is_primary: 1,
      status: 'stopped',
      agent_config_id: utilityConfigId,
      agent_sdk: 'utility',
      current_turn_id: 0,
    });
  });

  const createBuilder = (data) =>
    app.service('agents').create({ session_id: sessionId, ...data }, params());

  it('names the builder from the naming prompt via the utility model', async () => {
    await db('users')
      .where({ id: user.id })
      .update({
        utility_default_config_id: utilityConfigId,
        utility_default_model: JSON.stringify({ model: 'utility-cheap', model_params: null }),
      });

    const agent = await createBuilder({
      agent_type: 'builder',
      naming_prompt: 'Fix the flaky login test now',
    });

    expect(agent.name).toBe('Fix flaky login test');
    const [, opts] = completeText.mock.calls[0];
    expect(opts).toMatchObject({
      userId: user.id,
      agentConfigId: utilityConfigId,
      model: 'utility-cheap',
    });
  });

  it('falls back to the prompt heuristic when no utility default is set', async () => {
    const agent = await createBuilder({
      agent_type: 'builder',
      naming_prompt: 'Refactor the storage layer for speed',
    });

    expect(agent.name).toBe('Refactor the storage layer');
    expect(completeText).not.toHaveBeenCalled();
  });

  it('falls back to the heuristic when the utility model fails or yields nothing', async () => {
    await db('users')
      .where({ id: user.id })
      .update({
        utility_default_config_id: utilityConfigId,
        utility_default_model: JSON.stringify({ model: 'utility-cheap', model_params: null }),
      });
    completeText.mockRejectedValueOnce(new Error('model down'));

    const failing = await createBuilder({
      agent_type: 'builder',
      naming_prompt: 'Investigate the flaky login test failure',
    });
    expect(failing.name).toBe('Investigate the flaky login');

    completeText.mockResolvedValueOnce('   ');
    const empty = await createBuilder({
      agent_type: 'builder',
      naming_prompt: 'Clean up leftover build artifacts',
    });
    expect(empty.name).toBe('Clean up leftover build');
  });

  it('names a manual start without a prompt Builder', async () => {
    const agent = await createBuilder({ agent_type: 'builder' });
    expect(agent.name).toBe('Builder');
    expect(agent.is_primary).toBe(0);
    expect(completeText).not.toHaveBeenCalled();
  });

  it('keeps an explicit name and never persists the naming hint', async () => {
    const agent = await createBuilder({
      agent_type: 'builder',
      name: 'My own name',
      naming_prompt: 'Fix the flaky login test now',
    });

    expect(agent.name).toBe('My own name');
    expect(completeText).not.toHaveBeenCalled();
    const row = await db('agents').where({ id: agent.id }).first();
    expect(row.naming_prompt).toBeUndefined();
    expect(Object.keys(row)).not.toContain('naming_prompt');
  });

  it('leaves the first (primary) builder unnamed default intact', async () => {
    const [freshSessionId] = await db('sessions').insert({
      user_id: user.id,
      repo_full_name: 'o/r',
      base_branch: 'main',
      short_id: 'def34',
      initial_prompt: 'work',
      status: 'stopped',
    });
    const agent = await app.service('agents').create(
      {
        session_id: freshSessionId,
        agent_type: 'builder',
        agent_config_id: utilityConfigId,
        naming_prompt: 'Fix the flaky login test now',
      },
      params()
    );
    expect(agent.is_primary).toBe(1);
    expect(agent.name).toBe('Builder');
  });

  it('still requires a name for subagents', async () => {
    await expect(
      app
        .service('agents')
        .create(
          { session_id: sessionId, agent_type: 'subagent', agent_config_id: utilityConfigId },
          params()
        )
    ).rejects.toThrow('name is required for a subagent');
  });

  it('renames a secondary builder and rejects renaming a subagent', async () => {
    const builder = await createBuilder({ agent_type: 'builder', name: 'Extra' });
    const renamed = await app.service('agents').patch(builder.id, { name: 'Scout' }, params());
    expect(renamed.name).toBe('Scout');

    const subagent = await app.service('agents').create(
      {
        session_id: sessionId,
        agent_type: 'subagent',
        agent_config_id: utilityConfigId,
        name: 'Worker',
      },
      params()
    );
    await expect(
      app.service('agents').patch(subagent.id, { name: 'Renamed worker' }, params())
    ).rejects.toThrow('Only secondary builders can be renamed');
  });
});

describe('agents generateName', () => {
  let app;
  let user;
  let utilityConfigId;
  let sessionId;

  const params = () => ({ provider: 'rest', user });

  beforeEach(async () => {
    vi.clearAllMocks();
    completeText.mockResolvedValue('Fix flaky login test.');
    app = await makeApp();
    await db('users').insert({ github_id: 1, username: 'naming-user', status: 'approved' });
    user = await db('users').where({ username: 'naming-user' }).first();
    utilityConfigId = await insertTestAgentConfig(db, user.id, {
      sdk: 'utility',
      apiKey: 'ut-key',
    });
    [sessionId] = await db('sessions').insert({
      user_id: user.id,
      repo_full_name: 'o/r',
      base_branch: 'main',
      short_id: 'abc12',
      initial_prompt: 'work',
      status: 'stopped',
    });
    await db('agents').insert({
      session_id: sessionId,
      ref: 1,
      name: 'Builder',
      agent_type: 'builder',
      is_primary: 1,
      status: 'stopped',
      agent_config_id: utilityConfigId,
      agent_sdk: 'utility',
      model: 'session-model',
      current_turn_id: 0,
    });
  });

  it('names from the utility model when configured', async () => {
    await db('users')
      .where({ id: user.id })
      .update({
        utility_default_config_id: utilityConfigId,
        utility_default_model: JSON.stringify({ model: 'utility-cheap', model_params: null }),
      });

    const result = await app
      .service('agents')
      .generateName({ session_id: sessionId, prompt: 'Fix the flaky login test now' }, params());

    expect(result).toEqual({ name: 'Fix flaky login test' });
    const [, opts] = completeText.mock.calls[0];
    expect(opts).toMatchObject({
      userId: user.id,
      agentConfigId: utilityConfigId,
      model: 'utility-cheap',
    });
  });

  it('falls back to the session builder when no utility default is set', async () => {
    const result = await app
      .service('agents')
      .generateName(
        { session_id: sessionId, prompt: 'Refactor the storage layer for speed' },
        params()
      );

    expect(result).toEqual({ name: 'Fix flaky login test' });
    const [, opts] = completeText.mock.calls[0];
    expect(opts).toMatchObject({
      userId: user.id,
      agentConfigId: utilityConfigId,
      model: 'session-model',
    });
  });

  it('rejects when the model yields nothing usable', async () => {
    completeText.mockResolvedValueOnce('   ');
    await expect(
      app
        .service('agents')
        .generateName({ session_id: sessionId, prompt: 'Clean leftover artifacts' }, params())
    ).rejects.toThrow('Could not generate a label');
  });

  it('requires a prompt and session_id', async () => {
    await expect(
      app.service('agents').generateName({ session_id: sessionId, prompt: '  ' }, params())
    ).rejects.toThrow('prompt is required');
    await expect(
      app.service('agents').generateName({ prompt: 'Fix the login' }, params())
    ).rejects.toThrow('session_id is required');
  });
});
