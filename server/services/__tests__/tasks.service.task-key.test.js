/**
 * Tasks service: resolving a task by name.
 *
 * Callers (the UI, the MCP tools) name a `.baguette.yaml` task; the command, ports and
 * label are resolved server-side. A raw `command` stays available for ad-hoc runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { BadRequest } from '@feathersjs/errors';
import { createTestDb } from '../../test-utils/db.js';
import { registerTasksService } from '../feathers/tasks.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { Task } from '../task.js';
import { loadBaguetteConfig } from '../baguette-config.js';

// Prevent actual process spawning
vi.spyOn(Task.prototype, 'start').mockReturnValue(undefined);

vi.mock('../feathers/claude-agent.service.js', () => ({
  getSessionEnv: vi.fn().mockResolvedValue({}),
}));

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadBaguetteConfig: vi.fn().mockResolvedValue(null) };
});

const CONFIG = {
  session: {
    init: 'pnpm install\npnpm run migrate',
    tasks: {
      'run-tests': { run: 'vitest run' },
      'dev-server': { run: 'pnpm run dev', ports: ['PORT', 'VITE_PORT'] },
      seed: { run: 'rm -f db.sqlite\npnpm run migrate' },
    },
  },
};

describe('Tasks service — task_key resolution', (hooks) => {
  let app;
  let userId;
  let sessionId;

  const params = () => ({ provider: 'rest', user: { id: userId } });
  const create = (data) => app.service('tasks').create(data, params());

  const db = createTestDb(hooks);

  beforeEach(async () => {
    loadBaguetteConfig.mockResolvedValue(CONFIG);

    await db('users').insert({ github_id: 1001, username: 'alice', approved: true });
    userId = (await db('users').where({ username: 'alice' }).first()).id;

    await db('repos').insert({ full_name: 'test/repo', bare_path: '/tmp/repo' });
    const repoId = (await db('repos').where({ full_name: 'test/repo' }).first()).id;

    [sessionId] = await db('sessions').insert({
      user_id: userId,
      repo_id: repoId,
      repo_full_name: 'test/repo',
      base_branch: 'main',
      initial_prompt: 'p',
      short_id: 's1',
      status: 'active',
      worktree_path: 'repos/test/worktree',
      initialized: true,
    });

    app = feathers();
    app.set('db', db);
    registerTasksService(app);
    registerSessionsService(app);
    await app.setup();
    app.service('tasks')._resetForTest();
  });

  it('resolves the command, label and task_key from the task name alone', async () => {
    const task = await create({ session_id: sessionId, task_key: 'run-tests' });
    expect(task.command).toBe('vitest run');
    expect(task.label).toBe('run-tests');
    expect(task.task_key).toBe('run-tests');
  });

  it('resolves ports declared on the task, so the client need not send them', async () => {
    const task = await create({ session_id: sessionId, task_key: 'dev-server' });
    expect(app.service('tasks').getTask(task.id)._portEnvVars).toEqual(['PORT', 'VITE_PORT']);
  });

  it('keeps a multi-line run block intact for the script file', async () => {
    const task = await create({ session_id: sessionId, task_key: 'seed' });
    expect(task.command).toBe('rm -f db.sqlite\npnpm run migrate');
  });

  it('appends args to the resolved command', async () => {
    const task = await create({
      session_id: sessionId,
      task_key: 'run-tests',
      args: ['src/foo.test.js', '--bail'],
    });
    expect(task.command).toBe('vitest run src/foo.test.js --bail');
  });

  it('rejects a task name that is not in .baguette.yaml', async () => {
    await expect(create({ session_id: sessionId, task_key: 'nope' })).rejects.toBeInstanceOf(
      BadRequest
    );
  });

  it('rejects a create with neither task_key nor command', async () => {
    await expect(create({ session_id: sessionId })).rejects.toThrow(
      'A task_key or a command is required'
    );
  });

  it('still accepts an ad-hoc command with no task_key', async () => {
    const task = await create({ session_id: sessionId, command: 'echo hi' });
    expect(task.command).toBe('echo hi');
    expect(task.task_key).toBeNull();
    expect(task.label).toBeNull();
  });

  it('surfaces a .baguette.yaml parse error instead of starting the task', async () => {
    loadBaguetteConfig.mockResolvedValue({ error: 'bad YAML' });
    await expect(create({ session_id: sessionId, task_key: 'run-tests' })).rejects.toThrow(
      'bad YAML'
    );
  });

  it('drops client-supplied label and ports (the server owns them)', async () => {
    const task = await app
      .service('tasks')
      .create(
        { session_id: sessionId, task_key: 'run-tests', label: 'spoofed', ports: ['PORT'] },
        params()
      );
    expect(task.label).toBe('run-tests');
    expect(app.service('tasks').getTask(task.id)._portEnvVars).toEqual([]);
  });

  it('runs baguette:init as a dependency, resolved by name, on an uninitialized session', async () => {
    await db('sessions').where({ id: sessionId }).update({ initialized: false });
    const task = await create({ session_id: sessionId, task_key: 'run-tests' });
    const deps = app.service('tasks').getTask(task.id)._dependsOn;
    expect(deps).toHaveLength(1);
    expect(deps[0].label).toBe('baguette:init');
    expect(deps[0].command).toBe('pnpm install\npnpm run migrate');
  });
});
