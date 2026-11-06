import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerSessionTodosService } from '../feathers/session-todos.service.js';
import { registerSessionPlansService } from '../feathers/session-plans.service.js';

const db = createTestDb();
const params = (user) => ({ provider: 'rest', user });

function makeApp() {
  const app = feathers();
  app.set('db', db);
  registerSessionsService(app);
  registerAgentsService(app);
  registerSessionTodosService(app);
  registerSessionPlansService(app);
  return app;
}

let app;
let owner;
let other;
let sessionId;

beforeEach(async () => {
  await db('users').insert([
    { github_id: 1, username: 'alice', status: 'approved' },
    { github_id: 2, username: 'bob', status: 'approved' },
  ]);
  owner = await db('users').where({ username: 'alice' }).first();
  other = await db('users').where({ username: 'bob' }).first();
  const [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
  sessionId = await insertTestSession(db, {
    user_id: owner.id,
    repo_id: repoId,
    repo_full_name: 'o/r',
    base_branch: 'main',
    initial_prompt: 't',
    short_id: 'sharew',
    status: 'stopped',
    session_path: '/tmp/wt',
    is_shared: 1,
  });
  app = makeApp();
  await app.setup();
});

describe('shared session owner-only writes', () => {
  it('lets a collaborator read todos and plans but not create, patch, or remove them', async () => {
    const todo = await app.service('session-todos').create(
      {
        session_id: sessionId,
        title: 'Ship it',
        content: 'Do the work',
      },
      { user: owner }
    );
    const plan = await app
      .service('session-plans')
      .create({ session_id: sessionId, markdown: '# Plan' }, { user: owner });

    const todos = await app.service('session-todos').find({
      ...params(other),
      query: { session_id: sessionId },
    });
    expect((todos.data ?? todos).map((row) => row.title)).toEqual(['Ship it']);
    const plans = await app.service('session-plans').find({
      ...params(other),
      query: { session_id: sessionId },
    });
    expect((plans.data ?? plans).map((row) => row.markdown)).toEqual(['# Plan']);

    await expect(
      app
        .service('session-todos')
        .create({ session_id: sessionId, title: 'Nope', content: 'Nope' }, params(other))
    ).rejects.toThrow(/Session not found/);
    await expect(
      app.service('session-todos').patch(todo.id, { status: 'completed' }, params(other))
    ).rejects.toThrow(/Session not found/);
    await expect(app.service('session-todos').remove(todo.id, params(other))).rejects.toThrow(
      /Session not found/
    );

    await expect(
      app
        .service('session-plans')
        .create({ session_id: sessionId, markdown: '# Hijack' }, params(other))
    ).rejects.toThrow(/Session not found/);
    await expect(
      app.service('session-plans').patch(plan.id, { markdown: '# Hijack' }, params(other))
    ).rejects.toThrow(/Session not found/);
    await expect(app.service('session-plans').remove(plan.id, params(other))).rejects.toThrow(
      /Session not found/
    );

    const stillTodo = await db('session_todos').where({ id: todo.id }).first();
    expect(stillTodo.status).toBe('pending');
    const stillPlan = await db('session_plans').where({ id: plan.id }).first();
    expect(stillPlan.markdown).toBe('# Plan');
  });

  it('lets the owner mutate todos and plans on a shared session', async () => {
    const todo = await app.service('session-todos').create(
      {
        session_id: sessionId,
        title: 'Ship it',
        content: 'Do the work',
      },
      params(owner)
    );
    const patched = await app
      .service('session-todos')
      .patch(todo.id, { status: 'completed' }, params(owner));
    expect(patched.status).toBe('completed');

    const plan = await app
      .service('session-plans')
      .create({ session_id: sessionId, markdown: '# Plan' }, params(owner));
    const updated = await app
      .service('session-plans')
      .patch(plan.id, { markdown: '# Updated' }, params(owner));
    expect(updated.markdown).toBe('# Updated');
  });
});
