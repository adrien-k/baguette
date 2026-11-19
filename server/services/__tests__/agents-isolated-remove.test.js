/**
 * agents.remove — isolated subagent rows must tear down git worktrees before delete.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';
import { registerAgentConfigsService } from '../feathers/agent-configs.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import * as subagentWorktree from '../subagent-worktree.js';

const db = createTestDb();

async function makeApp() {
  const app = feathers();
  app.set('db', db);
  registerAgentConfigsService(app);
  app.use(
    'sessions',
    {
      get: async (id) => {
        const row = await db('sessions')
          .where({ id: Number(id) })
          .first();
        return row ?? { id: Number(id) };
      },
      resetUsageTotals: vi.fn(),
    },
    { methods: ['get', 'resetUsageTotals'] }
  );
  registerAgentsService(app);
  await app.setup();
  return app;
}

describe('agents.remove isolated subagent worktree', () => {
  let app;
  let user;
  let sessionId;
  let repo;
  let teardownSpy;
  let killTasksSpy;

  const params = () => ({ provider: 'rest', user });

  beforeEach(async () => {
    vi.restoreAllMocks();
    teardownSpy = vi
      .spyOn(subagentWorktree, 'teardownIsolatedSubagentWorktree')
      .mockResolvedValue();
    killTasksSpy = vi
      .spyOn(subagentWorktree, 'killTasksUnderSubagentWorktrees')
      .mockResolvedValue();
    app = await makeApp();
    await db('users').insert({ github_id: 88001, username: 'iso-remove-user', status: 'approved' });
    user = await db('users').where({ username: 'iso-remove-user' }).first();
    await db('repos').insert({
      full_name: 'acme/iso-remove',
      stripped_name: 'acme/iso-remove',
      repo_path: 'repos/acme/iso-remove/main',
    });
    repo = await db('repos').where({ full_name: 'acme/iso-remove' }).first();
    await insertTestAgentConfig(db, user.id, { sdk: 'mock', apiKey: 'k' });

    sessionId = await insertTestSession(db, {
      user_id: user.id,
      repo_id: repo.id,
      repo_full_name: repo.full_name,
      base_branch: 'main',
      short_id: 'iso01',
      initial_prompt: 'work',
      status: 'stopped',
      agent_sdk: 'mock',
      model: 'mock',
    });
  });

  it('calls teardownIsolatedSubagentWorktree when worktree_path is set', async () => {
    const [subId] = await db('agents').insert({
      session_id: sessionId,
      ref: 2,
      name: 'Isolated',
      agent_type: 'subagent',
      is_primary: 0,
      status: 'stopped',
      agent_sdk: 'mock',
      model: 'mock',
      worktree_path: 'repos/acme/iso-remove/sessions/iso01/sub-worktrees/42',
      local_branch: 'baguette/subagent/42',
    });

    await app.service('agents').remove(subId, params());

    expect(killTasksSpy).toHaveBeenCalledTimes(1);
    expect(killTasksSpy).toHaveBeenCalledWith(
      app,
      sessionId,
      expect.arrayContaining([
        expect.objectContaining({
          id: subId,
          worktree_path: 'repos/acme/iso-remove/sessions/iso01/sub-worktrees/42',
        }),
      ])
    );
    expect(killTasksSpy.mock.invocationCallOrder[0]).toBeLessThan(
      teardownSpy.mock.invocationCallOrder[0]
    );
    expect(teardownSpy).toHaveBeenCalledTimes(1);
    expect(teardownSpy).toHaveBeenCalledWith(repo, {
      worktree_path: 'repos/acme/iso-remove/sessions/iso01/sub-worktrees/42',
      local_branch: 'baguette/subagent/42',
    });
    expect(await db('agents').where({ id: subId }).first()).toBeUndefined();
  });

  it('does not call teardown when worktree_path is null', async () => {
    const [subId] = await db('agents').insert({
      session_id: sessionId,
      ref: 3,
      name: 'Shared cwd',
      agent_type: 'subagent',
      is_primary: 0,
      status: 'stopped',
      agent_sdk: 'mock',
      model: 'mock',
      worktree_path: null,
      local_branch: null,
    });

    await app.service('agents').remove(subId, params());

    expect(killTasksSpy).not.toHaveBeenCalled();
    expect(teardownSpy).not.toHaveBeenCalled();
    expect(await db('agents').where({ id: subId }).first()).toBeUndefined();
  });
});
