import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { insertSessionWithPrimaryBuilder } from '../../test-utils/session-agents.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { createListAgentsTool } from '../mcp/tools/list-agents.js';
import { createAccountContext } from '../mcp/lib/account-context.js';

const db = createTestDb();
const params = (user) => ({ provider: 'rest', user });

function payload(result) {
  return JSON.parse(result.content[0].text);
}

let app;
let user;
let sessionId;

beforeEach(async () => {
  await db('agents').delete();
  await db('sessions').delete();
  await db('users').delete();
  const [userId] = await db('users').insert({
    github_id: 55,
    username: 'list-ag',
    status: 'approved',
  });
  user = await db('users').where({ id: userId }).first();
  const { insertTestAgentConfig } = await import('../../test-utils/agent-configs.js');
  const configId = await insertTestAgentConfig(db, user.id, { apiKey: 'k' });
  const [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
  sessionId = await insertSessionWithPrimaryBuilder(db, {
    user_id: user.id,
    repo_id: repoId,
    repo_full_name: 'o/r',
    short_id: 'lag',
    initial_prompt: 't',
    base_branch: 'main',
    local_branch: 'feat',
    status: 'stopped',
    session_path: '/tmp/wt',
    agent_config_id: configId,
    model: 'sonnet',
  });
  await db('agents').insert({
    session_id: sessionId,
    ref: 2,
    name: 'Reviewer',
    agent_type: 'reviewer',
    is_primary: 0,
    status: 'running',
    agent_config_id: configId,
    agent_sdk: 'claude',
    model: 'sonnet',
    current_turn_id: 1,
  });
  await db('agents').insert({
    session_id: sessionId,
    ref: 3,
    name: 'Scout',
    agent_type: 'subagent',
    is_primary: 0,
    status: 'completed',
    agent_config_id: configId,
    agent_sdk: 'claude',
    model: 'sonnet',
    current_turn_id: 1,
  });
  app = feathers();
  app.set('db', db);
  registerSessionsService(app);
  registerAgentsService(app);
  await app.setup();
});

describe('agents.listAgents', () => {
  it('returns all agent types by default', async () => {
    const result = await app.service('agents').listAgents({ session_id: sessionId }, params(user));
    expect(result.agents).toHaveLength(3);
    expect(result.agents.map((a) => a.agent_type).sort()).toEqual(
      ['builder', 'reviewer', 'subagent'].sort()
    );
  });

  it('filters by agent_types', async () => {
    const result = await app
      .service('agents')
      .listAgents({ session_id: sessionId, agent_types: ['reviewer'] }, params(user));
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({ agent_type: 'reviewer', status: 'running' });
  });

  it('filters subagents only with active_only', async () => {
    await db('agents').where({ agent_type: 'subagent', session_id: sessionId }).update({
      status: 'running',
    });
    const result = await app
      .service('agents')
      .listAgents(
        { session_id: sessionId, agent_types: ['subagent'], active_only: true },
        params(user)
      );
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('Scout');
  });
});

describe('ListAgents MCP tool', () => {
  it('returns agents for the caller session', async () => {
    const session = await db('sessions').where({ id: sessionId }).first();
    const ctx = createAccountContext(user, app, { callerSession: session });
    const tool = createListAgentsTool(ctx);
    const result = payload(await tool.handler({ agent_types: ['reviewer', 'builder'] }));
    expect(result.ok).toBe(true);
    expect(result.agents).toHaveLength(2);
  });
});
