import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerSessionPlansService } from '../feathers/session-plans.service.js';

const db = createTestDb();
const params = (user) => ({ provider: 'rest', user });

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerSessionsService(app);
  registerAgentsService(app);
  registerSessionPlansService(app);
  return app;
}

let app;
let user;
let sessionId;

beforeEach(async () => {
  await db('users').insert({ github_id: 1, username: 'alice', status: 'approved' });
  user = await db('users').where({ username: 'alice' }).first();
  const [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
  sessionId = await insertTestSession(db, {
    user_id: user.id,
    repo_id: repoId,
    repo_full_name: 'o/r',
    base_branch: 'main',
    initial_prompt: 't',
    short_id: 'plansvc',
    status: 'stopped',
    session_path: '/tmp/wt',
    agent_sdk: 'claude',
    model: 'sonnet',
  });
  app = makeApp(db);
  await app.setup();
});

describe('session-plans service', () => {
  it('clears current_plan_id on every agent pointing at a plan patched to completed', async () => {
    const plan = await app
      .service('session-plans')
      .create({ session_id: sessionId, markdown: '# Plan' }, { user });
    const otherPlan = await app
      .service('session-plans')
      .create({ session_id: sessionId, markdown: '# Other' }, { user });
    const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    await db('agents').where({ id: primary.id }).update({ current_plan_id: plan.id });
    const [extraId] = await db('agents').insert({
      session_id: sessionId,
      ref: 2,
      name: 'Extra',
      agent_type: 'builder',
      is_primary: 0,
      status: 'stopped',
      agent_sdk: primary.agent_sdk,
      model: primary.model,
      current_turn_id: 0,
      current_plan_id: plan.id,
    });
    const [unrelatedId] = await db('agents').insert({
      session_id: sessionId,
      ref: 3,
      name: 'Other plan',
      agent_type: 'builder',
      is_primary: 0,
      status: 'stopped',
      agent_sdk: primary.agent_sdk,
      model: primary.model,
      current_turn_id: 0,
      current_plan_id: otherPlan.id,
    });

    const patched = await app
      .service('session-plans')
      .patch(plan.id, { status: 'completed' }, params(user));

    expect(patched.status).toBe('completed');
    expect((await db('agents').where({ id: primary.id }).first()).current_plan_id).toBeNull();
    expect((await db('agents').where({ id: extraId }).first()).current_plan_id).toBeNull();
    expect((await db('agents').where({ id: unrelatedId }).first()).current_plan_id).toBe(
      otherPlan.id
    );
  });
});
