import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { insertSessionWithPrimaryBuilder } from '../../test-utils/session-agents.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';

const db = createTestDb();
const params = (user) => ({ provider: 'rest', user });

function makeApp() {
  const app = feathers();
  app.set('db', db);
  registerSessionsService(app);
  registerAgentsService(app);
  return app;
}

let app;
let owner;
let repoId;
let sessionId;
let secondaryId;

beforeEach(async () => {
  await db('users').delete();
  await db('sessions').delete();
  await db('agents').delete();
  await db('repos').delete();
  [owner] = await db('users')
    .insert({ github_id: 1, username: 'alice', status: 'approved' })
    .returning('*');
  [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
  sessionId = await insertSessionWithPrimaryBuilder(db, {
    user_id: owner.id,
    repo_id: repoId,
    repo_full_name: 'o/r',
    base_branch: 'main',
    initial_prompt: 't',
    short_id: 'pin1',
    status: 'stopped',
    session_path: '/tmp/wt',
  });
  const [secondary] = await db('agents')
    .insert({
      session_id: sessionId,
      agent_type: 'builder',
      is_primary: 0,
      name: 'Extra',
      status: 'stopped',
      ref: 2,
      agent_sdk: 'claude',
      model: 'sonnet',
    })
    .returning('id');
  secondaryId =
    typeof secondary === 'object'
      ? secondary.id
      : (secondary ?? (await db('agents').where({ session_id: sessionId, ref: 2 }).first()).id);
  app = makeApp();
  await app.setup();
});

describe('sessions pinned_agent_id', () => {
  it('accepts patching pinned_agent_id for an agent in the session', async () => {
    const updated = await app
      .service('sessions')
      .patch(sessionId, { pinned_agent_id: secondaryId }, params(owner));
    expect(updated.pinned_agent_id).toBe(secondaryId);
  });

  it('rejects pinned_agent_id from another session', async () => {
    const otherSessionId = await insertTestSession(db, {
      user_id: owner.id,
      repo_id: repoId,
      repo_full_name: 'o/r',
      base_branch: 'main',
      initial_prompt: 't2',
      short_id: 'pin2',
      status: 'stopped',
      session_path: '/tmp/wt2',
    });
    const otherAgent = await db('agents')
      .where({ session_id: otherSessionId, is_primary: 1 })
      .first();
    await expect(
      app.service('sessions').patch(sessionId, { pinned_agent_id: otherAgent.id }, params(owner))
    ).rejects.toThrow(/pinned_agent_id must belong/);
  });

  it('rejects pinned_agent_id when the agent is not a builder', async () => {
    const [subagentId] = await db('agents')
      .insert({
        session_id: sessionId,
        agent_type: 'subagent',
        is_primary: 0,
        name: 'Scout',
        status: 'stopped',
        ref: 5,
        agent_sdk: 'claude',
        model: 'sonnet',
      })
      .returning('id');
    const id = typeof subagentId === 'object' ? subagentId.id : subagentId;
    await expect(
      app.service('sessions').patch(sessionId, { pinned_agent_id: id }, params(owner))
    ).rejects.toThrow(/must be a builder/);
  });

  it('clears pinned_agent_id when that agent is removed', async () => {
    await db('sessions').where({ id: sessionId }).update({ pinned_agent_id: secondaryId });
    await app.service('agents').remove(secondaryId, params(owner));
    const session = await db('sessions').where({ id: sessionId }).first();
    expect(session.pinned_agent_id).toBeNull();
  });
});
