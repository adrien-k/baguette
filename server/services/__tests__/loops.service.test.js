/**
 * Integration tests for the loops Feathers service, against an in-memory SQLite DB.
 * `sessions` and `users` are stubbed: running a loop only needs to know that the right
 * session payload was handed over.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { BadRequest, NotFound } from '@feathersjs/errors';
import { createTestDb } from '../../test-utils/db.js';
import { registerLoopsService } from '../feathers/loops.service.js';

const sessionsCreate = vi.fn(async (data) => ({ id: 77, ...data }));
const usersGet = vi.fn(async (id) => ({ id, access_token: 'gh-token' }));
const messagesCreate = vi.fn(async (data) => ({ id: 1, ...data }));
const queuedCreate = vi.fn(async (data) => ({ id: 2, ...data }));
const queuedRemove = vi.fn(async (id) => ({ id }));

const params = (userId) => ({ provider: 'rest', user: { id: userId } });

/** Content of the nth `messages.create` / `queued-messages.create` call. */
const sentContent = (mock, index = 0) =>
  JSON.parse(mock.mock.calls[index][0].message_json).message.content;

function makeApp(db) {
  const app = feathers();
  app.set('db', db);
  app.use('sessions', { create: sessionsCreate }, { methods: ['create'] });
  app.use('users', { get: usersGet }, { methods: ['get'] });
  app.use('messages', { create: messagesCreate }, { methods: ['create'] });
  app.use(
    'queued-messages',
    { create: queuedCreate, remove: queuedRemove },
    { methods: ['create', 'remove'] }
  );
  registerLoopsService(app);
  return app;
}

const loopData = (overrides = {}) => ({
  repo_full_name: 'test/repo',
  base_branch: 'main',
  prompt: 'Check the dependencies',
  schedule_type: 'interval',
  interval_minutes: 60,
  ...overrides,
});

describe('Loops service', (hooks) => {
  const db = createTestDb(hooks);

  let app;
  let aliceId;
  let bobId;

  beforeEach(async () => {
    vi.clearAllMocks();
    await db('users').insert([
      { github_id: 1, username: 'alice', access_token_encrypted: 'x', approved: true },
      { github_id: 2, username: 'bob', access_token_encrypted: 'x', approved: true },
    ]);
    aliceId = (await db('users').where({ username: 'alice' }).first()).id;
    bobId = (await db('users').where({ username: 'bob' }).first()).id;
    await db('repos').insert({ full_name: 'test/repo', bare_path: '/tmp/repo' });

    app = makeApp(db);
    await app.setup();
  });

  describe('create', () => {
    it('stores the loop for the calling user and arms the first run', async () => {
      const loop = await app.service('loops').create(loopData(), params(aliceId));

      expect(loop.user_id).toBe(aliceId);
      expect(loop.repo_id).toBe((await db('repos').first()).id);
      expect(loop.enabled).toBe(true);
      expect(new Date(loop.next_run_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('serializes weekdays and reads them back as an array', async () => {
      const loop = await app.service('loops').create(
        loopData({
          schedule_type: 'weekly',
          interval_minutes: null,
          time_of_day: '09:00',
          days_of_week: [1, 3],
          timezone: 'Europe/Paris',
        }),
        params(aliceId)
      );

      expect(loop.days_of_week).toEqual([1, 3]);
      expect((await db('loops').where({ id: loop.id }).first()).days_of_week).toBe('[1,3]');
    });

    it('rejects an invalid recurrence', async () => {
      await expect(
        app.service('loops').create(loopData({ interval_minutes: 1 }), params(aliceId))
      ).rejects.toBeInstanceOf(BadRequest);
    });

    it('rejects an unknown repository', async () => {
      await expect(
        app.service('loops').create(loopData({ repo_full_name: 'nope/nope' }), params(aliceId))
      ).rejects.toBeInstanceOf(NotFound);
    });

    it('ignores client-supplied bookkeeping fields', async () => {
      const loop = await app
        .service('loops')
        .create(loopData({ user_id: bobId, last_error: 'injected' }), params(aliceId));

      expect(loop.user_id).toBe(aliceId);
      expect(loop.last_error).toBeNull();
    });

    it('leaves a loop created disabled unscheduled', async () => {
      const loop = await app.service('loops').create(loopData({ enabled: false }), params(aliceId));
      expect(loop.enabled).toBe(false);
      expect(loop.next_run_at).toBeNull();
    });
  });

  describe('find / scoping', () => {
    it('only returns the caller’s loops', async () => {
      await app.service('loops').create(loopData(), params(aliceId));
      await app.service('loops').create(loopData({ prompt: 'bob task' }), params(bobId));

      const result = await app.service('loops').find(params(aliceId));
      expect(result.data).toHaveLength(1);
      expect(result.data[0].user_id).toBe(aliceId);
    });

    it('refuses to patch or remove another user’s loop', async () => {
      const loop = await app.service('loops').create(loopData(), params(aliceId));

      await expect(
        app.service('loops').patch(loop.id, { enabled: false }, params(bobId))
      ).rejects.toBeInstanceOf(NotFound);
      await expect(app.service('loops').remove(loop.id, params(bobId))).rejects.toBeInstanceOf(
        NotFound
      );
    });
  });

  describe('patch', () => {
    it('clears the next run when disabled and re-arms when enabled again', async () => {
      const loop = await app.service('loops').create(loopData(), params(aliceId));

      const disabled = await app
        .service('loops')
        .patch(loop.id, { enabled: false }, params(aliceId));
      expect(disabled.next_run_at).toBeNull();

      const enabled = await app.service('loops').patch(loop.id, { enabled: true }, params(aliceId));
      expect(new Date(enabled.next_run_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('recomputes the next run when the recurrence changes', async () => {
      const loop = await app.service('loops').create(loopData(), params(aliceId));
      const patched = await app
        .service('loops')
        .patch(loop.id, { interval_minutes: 1440 }, params(aliceId));

      const deltaMinutes = (new Date(patched.next_run_at) - Date.now()) / 60_000;
      expect(deltaMinutes).toBeGreaterThan(1400);
    });

    it('validates a partial recurrence change against the stored one', async () => {
      const loop = await app.service('loops').create(
        loopData({
          schedule_type: 'weekly',
          interval_minutes: null,
          time_of_day: '09:00',
          days_of_week: [1],
        }),
        params(aliceId)
      );

      await expect(
        app.service('loops').patch(loop.id, { days_of_week: [] }, params(aliceId))
      ).rejects.toBeInstanceOf(BadRequest);

      const patched = await app
        .service('loops')
        .patch(loop.id, { days_of_week: [2, 4] }, params(aliceId));
      expect(patched.days_of_week).toEqual([2, 4]);
      expect(patched.time_of_day).toBe('09:00');
    });
  });

  describe('runDue', () => {
    const makeDueLoop = async (overrides = {}) => {
      const loop = await app.service('loops').create(loopData(overrides), params(aliceId));
      await db('loops')
        .where({ id: loop.id })
        .update({ next_run_at: new Date(Date.now() - 60_000).toISOString() });
      return loop;
    };

    it('creates a session from the loop template and re-arms it', async () => {
      const loop = await makeDueLoop({
        agent_sdk: 'cursor',
        model: 'composer-1',
        plan_mode: true,
        auto_push: false,
        plugins: ['plugin-a'],
      });

      const results = await app.service('loops').runDue();

      expect(results).toEqual([{ loop_id: loop.id, session_id: 77 }]);
      expect(sessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          loop_id: loop.id,
          repo_full_name: 'test/repo',
          base_branch: 'main',
          initial_prompt: 'Check the dependencies',
          agent_sdk: 'cursor',
          model: 'composer-1',
          plan_mode: true,
          auto_push: false,
          plugins: ['plugin-a'],
        }),
        expect.objectContaining({ user: { id: aliceId, access_token: 'gh-token' } })
      );

      const row = await db('loops').where({ id: loop.id }).first();
      expect(row.last_session_id).toBe(77);
      expect(row.last_run_at).toBeTruthy();
      expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('skips disabled loops and loops that are not due yet', async () => {
      await app.service('loops').create(loopData(), params(aliceId)); // due in an hour
      const disabled = await makeDueLoop();
      await app.service('loops').patch(disabled.id, { enabled: false }, params(aliceId));

      expect(await app.service('loops').runDue()).toEqual([]);
      expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it('records the failure and still re-arms when the session cannot be created', async () => {
      const loop = await makeDueLoop();
      sessionsCreate.mockRejectedValueOnce(new Error('branch already in use'));

      const results = await app.service('loops').runDue();

      expect(results[0].error).toBe('branch already in use');
      const row = await db('loops').where({ id: loop.id }).first();
      expect(row.last_error).toBe('branch already in use');
      expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('disables a loop whose stored recurrence is no longer valid', async () => {
      const loop = await makeDueLoop();
      await db('loops').where({ id: loop.id }).update({ schedule_type: 'bogus' });

      await app.service('loops').runDue();

      const row = await db('loops').where({ id: loop.id }).first();
      expect(row.enabled).toBeFalsy();
      expect(row.last_error).toMatch(/schedule_type/);
      expect(sessionsCreate).not.toHaveBeenCalled();
    });
  });

  describe('runDue — single session mode', () => {
    const seedSession = async (overrides = {}) => {
      const [id] = await db('sessions').insert({
        user_id: aliceId,
        repo_full_name: 'test/repo',
        base_branch: 'main',
        initial_prompt: 'Check the dependencies',
        status: 'completed',
        short_id: `s${Math.random().toString(16).slice(2, 8)}`,
        ...overrides,
      });
      return id;
    };

    const makeDueSingleSessionLoop = async (overrides = {}) => {
      const loop = await app
        .service('loops')
        .create(loopData({ single_session: true, ...overrides }), params(aliceId));
      await db('loops')
        .where({ id: loop.id })
        .update({ next_run_at: new Date(Date.now() - 60_000).toISOString() });
      return loop;
    };

    it('starts and ties a session on the first run', async () => {
      const loop = await makeDueSingleSessionLoop();

      await app.service('loops').runDue();

      expect(sessionsCreate).toHaveBeenCalledOnce();
      const row = await db('loops').where({ id: loop.id }).first();
      expect(row.session_id).toBe(77);
      expect(row.last_session_id).toBe(77);
    });

    it('compacts then re-sends the prompt into the tied session on later runs', async () => {
      const sessionId = await seedSession();
      const loop = await makeDueSingleSessionLoop();
      await db('loops').where({ id: loop.id }).update({ session_id: sessionId });

      const results = await app.service('loops').runDue();

      expect(results).toEqual([{ loop_id: loop.id, session_id: sessionId }]);
      expect(sessionsCreate).not.toHaveBeenCalled();
      expect(sentContent(messagesCreate)).toBe('/compact');
      expect(messagesCreate.mock.calls[0][0]).toMatchObject({
        session_id: sessionId,
        subtype: 'baguette',
      });
      // The prompt is queued, so it only goes out once compaction has finished.
      expect(sentContent(queuedCreate)).toBe('Check the dependencies');
      expect(queuedCreate.mock.invocationCallOrder[0]).toBeLessThan(
        messagesCreate.mock.invocationCallOrder[0]
      );
    });

    it('takes the queued prompt back out if compaction cannot be started', async () => {
      const sessionId = await seedSession();
      const loop = await makeDueSingleSessionLoop();
      await db('loops').where({ id: loop.id }).update({ session_id: sessionId });
      messagesCreate.mockRejectedValueOnce(new Error('session is gone'));

      const results = await app.service('loops').runDue();

      expect(results[0].error).toBe('session is gone');
      expect(queuedRemove).toHaveBeenCalledWith(2, expect.anything());
    });

    it('sends only the prompt for a cursor session, which has no compaction', async () => {
      const sessionId = await seedSession({ agent_sdk: 'cursor' });
      const loop = await makeDueSingleSessionLoop({ agent_sdk: 'cursor' });
      await db('loops').where({ id: loop.id }).update({ session_id: sessionId });

      await app.service('loops').runDue();

      expect(queuedCreate).not.toHaveBeenCalled();
      expect(messagesCreate).toHaveBeenCalledOnce();
      expect(sentContent(messagesCreate)).toBe('Check the dependencies');
    });

    it('skips the run while the tied session is mid-turn', async () => {
      const sessionId = await seedSession({ status: 'running' });
      const loop = await makeDueSingleSessionLoop();
      await db('loops').where({ id: loop.id }).update({ session_id: sessionId });

      const results = await app.service('loops').runDue();

      expect(results[0].skipped).toMatch(/still in progress/);
      expect(messagesCreate).not.toHaveBeenCalled();
      expect(queuedCreate).not.toHaveBeenCalled();
      // Still re-armed, so the loop picks up again at its next slot.
      const row = await db('loops').where({ id: loop.id }).first();
      expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('starts a fresh session when the tied one was archived', async () => {
      const sessionId = await seedSession({ archived_at: new Date().toISOString() });
      const loop = await makeDueSingleSessionLoop();
      await db('loops').where({ id: loop.id }).update({ session_id: sessionId });

      await app.service('loops').runDue();

      expect(sessionsCreate).toHaveBeenCalledOnce();
      expect(messagesCreate).not.toHaveBeenCalled();
      const row = await db('loops').where({ id: loop.id }).first();
      expect(row.session_id).toBe(77);
    });

    it('unties the loop when single-session mode is switched off and back on', async () => {
      const loop = await makeDueSingleSessionLoop();
      await db('loops').where({ id: loop.id }).update({ session_id: 42 });

      const off = await app
        .service('loops')
        .patch(loop.id, { single_session: false }, params(aliceId));
      expect(off.session_id).toBeNull();
    });
  });
});
