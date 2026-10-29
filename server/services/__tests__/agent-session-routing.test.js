import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';
import { registerAgentConfigsService } from '../feathers/agent-configs.service.js';
import { agentServicePathForSession, getAgentServiceForSession } from '../agent-session-routing.js';

const db = createTestDb();

function makeApp() {
  const app = feathers();
  app.set('db', db);
  registerAgentConfigsService(app);
  app.use('claude-agent', { async get() {} }, { methods: ['get'] });
  app.service('agent-configs').registerSdk({
    key: 'claude',
    label: 'Claude',
    service_path: 'claude-agent',
  });
  return app;
}

describe('agent-session-routing', () => {
  let app;
  let userId;
  let configId;

  beforeEach(async () => {
    app = makeApp();
    await db('users').insert({ github_id: 1, username: 'dispatch-user', approved: true });
    const user = await db('users').where({ username: 'dispatch-user' }).first();
    userId = user.id;
    configId = await insertTestAgentConfig(db, userId, { apiKey: 'sk-ant' });
  });

  it('getAgentServiceForSession routes via agent_config_id', async () => {
    const [sessionId] = await db('sessions').insert({
      user_id: userId,
      repo_full_name: 'a/b',
      base_branch: 'main',
      initial_prompt: 'x',
    });
    await db('agents').insert({
      session_id: sessionId,
      name: 'Builder',
      agent_type: 'builder',
      is_primary: 1,
      status: 'stopped',
      agent_config_id: configId,
      agent_sdk: 'claude',
      model: 'sonnet',
      current_turn_id: 0,
    });
    const session = { id: sessionId, user_id: userId, repo_id: null };
    const svc = await getAgentServiceForSession(app, session);
    expect(svc).toBe(app.service('claude-agent'));
  });

  it('agentServicePathForSession uses review_agent_config_id when review=true', async () => {
    const cursorId = await insertTestAgentConfig(db, userId, {
      sdk: 'cursor',
      apiKey: 'cursor-key',
      apiKeyEnvVar: null,
    });
    app.use('cursor-agent', { async get() {} }, { methods: ['get'] });
    app.service('agent-configs').registerSdk({
      key: 'cursor',
      label: 'Cursor',
      service_path: 'cursor-agent',
    });
    const [sessionId] = await db('sessions').insert({
      user_id: userId,
      repo_full_name: 'a/b',
      base_branch: 'main',
      initial_prompt: 'x',
    });
    await db('agents').insert({
      session_id: sessionId,
      name: 'Builder',
      agent_type: 'builder',
      is_primary: 1,
      status: 'stopped',
      agent_config_id: configId,
      agent_sdk: 'claude',
      model: 'sonnet',
      current_turn_id: 0,
    });
    await db('agents').insert({
      session_id: sessionId,
      name: 'Reviewer',
      agent_type: 'reviewer',
      is_primary: 0,
      status: 'stopped',
      agent_config_id: cursorId,
      agent_sdk: 'cursor',
      model: 'sonnet',
      current_turn_id: 0,
    });
    const session = { id: sessionId, user_id: userId, repo_id: null };
    const path = await agentServicePathForSession(app, session, { review: true });
    expect(path).toBe('cursor-agent');
  });
});
