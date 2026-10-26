/**
 * Service tests for the in-memory tasks service.
 * Tasks are stored in memory; sessions/users are still in the DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerTasksService } from '../feathers/tasks.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { Task } from '../task.js';

// Prevent actual process spawning
vi.spyOn(Task.prototype, 'start').mockReturnValue(undefined);

vi.mock('../feathers/claude-agent.service.ts', () => ({
  getSessionEnv: vi.fn().mockResolvedValue({}),
}));

describe('Tasks service — in-memory', () => {
  let app;
  let userId1, userId2;
  let sessionId1, sessionId2;
  let taskId1, taskId2, taskId3;

  const providerParams = (userId) => ({
    provider: 'rest',
    user: userId != null ? { id: userId } : undefined,
  });

  const db = createTestDb();

  beforeEach(async () => {
    // Reset in-memory tasks between tests so IDs are predictable.

    await db('users').insert([
      { github_id: 1001, username: 'alice', approved: true },
      { github_id: 1002, username: 'bob', approved: true },
    ]);
    const u1 = await db('users').where({ username: 'alice' }).first();
    const u2 = await db('users').where({ username: 'bob' }).first();
    userId1 = u1.id;
    userId2 = u2.id;

    await db('repos').insert({ full_name: 'test/repo', repo_path: '/tmp/repo' });
    const repoId = (await db('repos').where({ full_name: 'test/repo' }).first()).id;

    [sessionId1] = await db('sessions').insert({
      user_id: userId1,
      repo_id: repoId,
      repo_full_name: 'test/repo',
      base_branch: 'main',
      initial_prompt: 'p1',
      short_id: 's1',
      status: 'active',
    });
    [sessionId2] = await db('sessions').insert({
      user_id: userId2,
      repo_id: repoId,
      repo_full_name: 'test/repo',
      base_branch: 'main',
      initial_prompt: 'p2',
      short_id: 's2',
      status: 'active',
    });

    app = feathers();
    app.set('db', db);
    registerTasksService(app);
    registerSessionsService(app);
    await app.setup();

    // Reset in-memory store and seed tasks via the service.
    app.service('tasks')._resetForTest();

    const t1 = app.service('tasks').createTask({ sessionId: sessionId1, command: 'echo 1' });
    t1.status = 'running';
    t1.started_at = new Date().toISOString();
    const t2 = app.service('tasks').createTask({ sessionId: sessionId1, command: 'echo 2' });
    t2.status = 'exited';
    t2.exit_code = 0;
    const t3 = app.service('tasks').createTask({ sessionId: sessionId2, command: 'echo 3' });
    taskId1 = t1.id;
    taskId2 = t2.id;
    taskId3 = t3.id;
  });

  // ── find ───────────────────────────────────────────────────────────────────

  describe('task.find', () => {
    it('returns only tasks belonging to the user (no query)', async () => {
      const result = await app.service('tasks').find({ query: {}, ...providerParams(userId1) });
      const data = Array.isArray(result) ? result : result.data;
      expect(data).toHaveLength(2);
      const ids = data.map((t) => t.id);
      expect(ids).toContain(taskId1);
      expect(ids).toContain(taskId2);
      expect(ids).not.toContain(taskId3);
    });

    it('filters by status', async () => {
      const result = await app.service('tasks').find({
        query: { status: 'running' },
        ...providerParams(userId1),
      });
      const data = Array.isArray(result) ? result : result.data;
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(taskId1);
      expect(data[0].status).toBe('running');
    });

    it('returns tasks for the second user', async () => {
      const result = await app.service('tasks').find({ query: {}, ...providerParams(userId2) });
      const data = Array.isArray(result) ? result : result.data;
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(taskId3);
    });

    it('returns empty list for a user with no sessions', async () => {
      await db('users').insert({
        github_id: 1003,
        username: 'carol',
        approved: true,
      });
      const userId3 = (await db('users').where({ username: 'carol' }).first()).id;
      const result = await app.service('tasks').find({ query: {}, ...providerParams(userId3) });
      const data = Array.isArray(result) ? result : result.data;
      expect(data).toHaveLength(0);
    });

    it('returns empty list when session_id belongs to another user', async () => {
      const result = await app.service('tasks').find({
        query: { session_id: sessionId2 },
        ...providerParams(userId1),
      });
      const data = Array.isArray(result) ? result : result.data;
      expect(data).toHaveLength(0);
    });

    it('rejects when not authenticated', async () => {
      await expect(app.service('tasks').find({ query: {}, provider: 'rest' })).rejects.toThrow(
        'Not authenticated'
      );
    });
  });

  // ── get ────────────────────────────────────────────────────────────────────

  describe('task.get', () => {
    it('returns the task when it belongs to the user', async () => {
      const task = await app.service('tasks').get(taskId1, providerParams(userId1));
      expect(task.id).toBe(taskId1);
      expect(task.session_id).toBe(sessionId1);
      expect(task.command).toBe('echo 1');
    });

    it("returns 404 for another user's task", async () => {
      await expect(
        app.service('tasks').get(taskId3, providerParams(userId1))
      ).rejects.toBeNotFoundError();
    });

    it('returns 404 for an unknown id', async () => {
      await expect(
        app.service('tasks').get(9999, providerParams(userId1))
      ).rejects.toBeNotFoundError();
    });

    it('rejects when not authenticated', async () => {
      await expect(app.service('tasks').get(taskId1, { provider: 'rest' })).rejects.toThrow(
        'Not authenticated'
      );
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('task.create', () => {
    it('creates a task in memory when session belongs to the user', async () => {
      const task = await app
        .service('tasks')
        .create({ session_id: sessionId1, command: 'echo ok' }, providerParams(userId1));
      expect(task.session_id).toBe(sessionId1);
      expect(task.command).toBe('echo ok');
      expect(task.status).toBe('waiting');
      await expect(
        app.service('tasks').get(task.id, providerParams(userId1))
      ).resolves.toMatchObject({ id: task.id });
    });

    it('returns 404 when session belongs to another user', async () => {
      await expect(
        app
          .service('tasks')
          .create({ session_id: sessionId2, command: 'x' }, providerParams(userId1))
      ).rejects.toBeNotFoundError();
    });

    it('rejects when not authenticated', async () => {
      await expect(
        app.service('tasks').create({ session_id: sessionId1, command: 'x' }, { provider: 'rest' })
      ).rejects.toThrow('Not authenticated');
    });
  });

  // ── kill ───────────────────────────────────────────────────────────────────

  describe('task.kill', () => {
    it('kills a running task and returns { success }', async () => {
      const t1 = app.service('tasks').getTask(taskId1);
      t1.kill = vi.fn().mockResolvedValue(true);

      const result = await app.service('tasks').kill(taskId1, providerParams(userId1));
      expect(t1.kill).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it("returns 404 when killing another user's task", async () => {
      await expect(
        app.service('tasks').kill(taskId3, providerParams(userId1))
      ).rejects.toBeNotFoundError();
    });

    it('rejects when not authenticated', async () => {
      await expect(app.service('tasks').kill(taskId1, { provider: 'rest' })).rejects.toThrow(
        'Not authenticated'
      );
    });
  });

  // ── logs ───────────────────────────────────────────────────────────────────

  describe('task.logs', () => {
    it('returns logs for a task', async () => {
      const t1 = app.service('tasks').getTask(taskId1);
      t1.getLogs = vi.fn().mockReturnValue('line 1\nline 2');

      const result = await app.service('tasks').logs(taskId1, providerParams(userId1));
      expect(t1.getLogs).toHaveBeenCalled();
      expect(result).toEqual({ id: taskId1, logs: 'line 1\nline 2' });
    });

    it('returns empty string when task has no logs', async () => {
      const t1 = app.service('tasks').getTask(taskId1);
      t1.getLogs = vi.fn().mockReturnValue('');

      const result = await app.service('tasks').logs(taskId1, providerParams(userId1));
      expect(result.logs).toBe('');
    });

    it("returns 404 for another user's task", async () => {
      await expect(
        app.service('tasks').logs(taskId3, providerParams(userId1))
      ).rejects.toBeNotFoundError();
    });

    it('rejects when not authenticated', async () => {
      await expect(app.service('tasks').logs(taskId1, { provider: 'rest' })).rejects.toThrow(
        'Not authenticated'
      );
    });
  });

  // ── patch ──────────────────────────────────────────────────────────────────

  describe('task.patch', () => {
    it('updates the in-memory task when called without a provider (internal)', async () => {
      const result = await app
        .service('tasks')
        .patch(taskId1, { status: 'exited', exit_code: 0 }, { user: { id: userId1 } });
      expect(result.id).toBe(taskId1);
      expect(result.status).toBe('exited');
      expect(app.service('tasks').getTask(taskId1).exit_code).toBe(0);
    });

    it('rejects when not authenticated', async () => {
      await expect(
        app.service('tasks').patch(taskId1, { status: 'exited' }, { provider: 'rest' })
      ).rejects.toThrow('Not authenticated');
    });

    it('rejects external access', async () => {
      await expect(
        app
          .service('tasks')
          .patch(taskId1, { status: 'exited' }, { user: { id: userId1 }, provider: 'rest' })
      ).rejects.toThrow('External access forbidden');
    });
  });

  // ── remove ─────────────────────────────────────────────────────────────────

  describe('task.remove', () => {
    it('removes the task from memory', async () => {
      await app.service('tasks').remove(taskId1, providerParams(userId1));
      expect(app.service('tasks').getTask(taskId1)).toBeNull();
    });

    it("returns 404 when removing another user's task", async () => {
      await expect(
        app.service('tasks').remove(taskId3, providerParams(userId1))
      ).rejects.toBeNotFoundError();
    });

    it('rejects when not authenticated', async () => {
      await expect(app.service('tasks').remove(taskId1, { provider: 'rest' })).rejects.toThrow(
        'Not authenticated'
      );
    });
  });
});
