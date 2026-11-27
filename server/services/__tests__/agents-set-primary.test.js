import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { registerAgentsService } from '../feathers/agents.service.js';

const db = createTestDb();
const params = (user) => ({ provider: 'rest', user });

async function makeApp() {
  const app = feathers();
  app.set('db', db);
  app.use(
    'sessions',
    {
      get: async (id, p) => {
        const row = await db('sessions')
          .where({ id: Number(id) })
          .first();
        if (!row || row.user_id !== p.user.id) throw new Error('not found');
        return row;
      },
    },
    { methods: ['get'] }
  );
  registerAgentsService(app);
  await app.setup();
  return app;
}

describe('agents setPrimary', () => {
  let app;
  let userId;
  let sessionId;
  let primaryId;
  let secondaryId;

  beforeEach(async () => {
    app = await makeApp();
    await db('users').insert({ github_id: 77, username: 'owner', status: 'approved' });
    const user = await db('users').where({ username: 'owner' }).first();
    userId = user.id;

    await db('repos').insert({ full_name: 'test/repo', repo_path: '/tmp/repo' });
    const repo = await db('repos').where({ full_name: 'test/repo' }).first();

    sessionId = await insertTestSession(db, {
      user_id: userId,
      repo_id: repo.id,
      repo_full_name: 'test/repo',
      base_branch: 'main',
      initial_prompt: 'Task',
      short_id: 'sp01aa',
      status: 'stopped',
    });

    primaryId = (await db('agents').where({ session_id: sessionId, is_primary: 1 }).first()).id;
    [secondaryId] = await db('agents').insert({
      session_id: sessionId,
      ref: 2,
      name: 'Extra',
      agent_type: 'builder',
      is_primary: 0,
      status: 'stopped',
      agent_sdk: 'claude',
      model: 'sonnet',
      current_turn_id: 0,
    });
  });

  it('promotes a secondary builder and demotes the current primary', async () => {
    const result = await app
      .service('agents')
      .setPrimary({ agent_id: secondaryId }, params({ id: userId }));
    expect(result.ok).toBe(true);
    expect(result.agent_id).toBe(secondaryId);
    expect(result.previous_primary_id).toBe(primaryId);

    const primary = await db('agents').where({ id: primaryId }).first();
    const secondary = await db('agents').where({ id: secondaryId }).first();
    expect(Number(primary.is_primary)).toBe(0);
    expect(Number(secondary.is_primary)).toBe(1);
  });

  it('rejects when the target builder is running', async () => {
    await db('agents').where({ id: secondaryId }).update({ status: 'running' });
    await expect(
      app.service('agents').setPrimary({ agent_id: secondaryId }, params({ id: userId }))
    ).rejects.toThrow(/Stop this builder/);
  });

  it('rejects when the current primary is running', async () => {
    await db('agents').where({ id: primaryId }).update({ status: 'running' });
    await expect(
      app.service('agents').setPrimary({ agent_id: secondaryId }, params({ id: userId }))
    ).rejects.toThrow(/current primary/);
  });
});
