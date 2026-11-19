/**
 * Tasks service: isolated subagent cwd, init scope, and depends-on cwd matching.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { registerTasksService } from '../feathers/tasks.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { Task } from '../task.js';
import { loadBaguetteConfig } from '../baguette-config.js';
import { resolveDataDirRelativePath } from '../../config.js';

vi.spyOn(Task.prototype, 'start').mockReturnValue(undefined);

vi.mock('../../agent-sdks/claude/agent-service.ts', () => ({
  getSessionEnv: vi.fn().mockResolvedValue({}),
}));

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadBaguetteConfig: vi.fn().mockResolvedValue(null) };
});

const CONFIG = {
  session: {
    init: 'pnpm install',
    tasks: {
      'run-tests': { run: 'vitest run' },
      'dev-server': { run: 'pnpm run dev', ports: ['PORT'], 'depends-on': ['postgres'] },
      postgres: { type: 'docker', container: { image: 'postgres:16' } },
    },
  },
};

describe('Tasks service — isolated caller cwd and init', () => {
  let app;
  let userId;
  let sessionId;
  let agentId;

  // Omit provider so `only()` does not strip caller_cwd / caller_agent_id.
  const params = () => ({ user: { id: userId } });
  const create = (data) => app.service('tasks').create(data, params());

  const db = createTestDb();

  beforeEach(async () => {
    loadBaguetteConfig.mockResolvedValue(CONFIG);

    await db('users').insert({ github_id: 2002, username: 'bob', status: 'approved' });
    userId = (await db('users').where({ username: 'bob' }).first()).id;

    await db('repos').insert({ full_name: 'test/repo2', repo_path: '/tmp/repo2' });
    const repoId = (await db('repos').where({ full_name: 'test/repo2' }).first()).id;

    sessionId = await insertTestSession(db, {
      user_id: userId,
      repo_id: repoId,
      repo_full_name: 'test/repo2',
      base_branch: 'main',
      initial_prompt: 'p',
      short_id: 's2',
      status: 'active',
      session_path: 'repos/test/parent-wt',
      initialized: true,
      agent_sdk: 'mock',
      model: 'mock',
    });

    const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    [agentId] = await db('agents').insert({
      session_id: sessionId,
      ref: 2,
      name: 'Isolated subagent',
      agent_type: 'subagent',
      is_primary: 0,
      agent_sdk: primary?.agent_sdk ?? 'mock',
      model: primary?.model ?? 'mock',
      model_params: primary?.model_params ?? null,
      agent_config_id: primary?.agent_config_id ?? null,
      worktree_path: 'repos/test/sub-wt',
      initialized: 0,
    });

    app = feathers();
    app.set('db', db);
    registerTasksService(app);
    registerSessionsService(app);
    await app.setup();
    app.service('tasks')._resetForTest();
  });

  it('runs baguette:init for isolated agents when session is already initialized', async () => {
    const task = await create({
      session_id: sessionId,
      task_key: 'run-tests',
      caller_cwd: '/tmp/sub-wt',
      caller_agent_id: agentId,
    });
    const deps = app.service('tasks').getTask(task.id)._dependsOn;
    expect(deps).toHaveLength(1);
    expect(deps[0].task_key).toBe('baguette:init');
    expect(deps[0]._cwd).toBe('/tmp/sub-wt');
    expect(app.service('tasks').getTask(task.id)._cwd).toBe('/tmp/sub-wt');
  });

  it('marks agents.initialized after isolated init success without touching sessions.initialized', async () => {
    const task = await create({
      session_id: sessionId,
      task_key: 'run-tests',
      caller_cwd: '/tmp/sub-wt',
      caller_agent_id: agentId,
    });
    const init = app.service('tasks').getTask(task.id)._dependsOn[0];
    init.exit(0);
    await vi.waitFor(async () => {
      expect((await db('agents').where({ id: agentId }).first()).initialized).toBe(1);
    });
    expect((await db('sessions').where({ id: sessionId }).first()).initialized).toBe(1);
  });

  it('shares one in-flight init per isolated agent id', async () => {
    const [taskA, taskB] = await Promise.all([
      create({
        session_id: sessionId,
        task_key: 'run-tests',
        caller_cwd: '/tmp/sub-wt',
        caller_agent_id: agentId,
      }),
      create({
        session_id: sessionId,
        task_key: 'dev-server',
        caller_cwd: '/tmp/sub-wt',
        caller_agent_id: agentId,
      }),
    ]);
    const initA = app.service('tasks').getTask(taskA.id)._dependsOn[0];
    const initB = app.service('tasks').getTask(taskB.id)._dependsOn[0];
    expect(initA.id).toBe(initB.id);
  });

  it('does not reuse parent dev-server when isolated cwd differs', async () => {
    const parentDev = app.service('tasks').createTask({
      sessionId,
      command: 'pnpm dev',
      taskKey: 'dev-server',
      cwd: '/tmp/parent-wt',
    });
    parentDev.status = 'running';

    const isolatedTask = await create({
      session_id: sessionId,
      task_key: 'dev-server',
      caller_cwd: '/tmp/sub-wt',
      caller_agent_id: agentId,
      skipInit: true,
    });

    expect(isolatedTask.id).not.toBe(parentDev.id);
    expect(app.service('tasks').getTask(isolatedTask.id)._cwd).toBe('/tmp/sub-wt');
    expect(
      app
        .service('tasks')
        ._findRunningTask(sessionId, 'dev-server', { cwd: '/tmp/parent-wt', matchCwd: true })
    ).toBe(parentDev);
  });

  it('starts docker depends-on with session worktree cwd', async () => {
    const sessionRow = await db('sessions').where({ id: sessionId }).first();
    const sessionCwd = resolveDataDirRelativePath(sessionRow.session_path);
    const task = await create({
      session_id: sessionId,
      task_key: 'dev-server',
      caller_cwd: '/tmp/sub-wt',
      caller_agent_id: agentId,
      skipInit: true,
    });
    const postgres = app.service('tasks').getTask(task.id)._dependsOn[0];
    expect(postgres.task_key).toBe('postgres');
    expect(postgres._cwd).toBe(sessionCwd);
    expect(postgres._cwd).not.toBe('/tmp/sub-wt');
  });
});
