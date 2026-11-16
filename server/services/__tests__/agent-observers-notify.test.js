/**
 * `agent_observers` wake-ups: an observed agent's turn end posts a summary back to
 * each observer agent (subagent parent pairs and cross-session watches alike).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerQueuedMessagesService } from '../feathers/queued-messages.service.js';
import { useClaudeAgentStub } from '../../test-utils/agent-sdks.js';
import { setAgentTurnTerminal } from '../agent-turn-patch.js';
import { notifyAgentObservers } from '../agent-observers-notify.js';
import { insertAgentObserver } from '../agents-db.js';

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  };
});

const db = createTestDb();

function parseUserPayload(row) {
  return JSON.parse(row.message_json);
}

function makeApp(dbRef, { handleMessageCreated } = {}) {
  const app = feathers();
  app.set('db', dbRef);
  registerSessionsService(app);
  registerAgentsService(app);
  useClaudeAgentStub(
    app,
    { handleMessageCreated: handleMessageCreated ?? vi.fn().mockResolvedValue(undefined) },
    ['handleMessageCreated']
  );
  registerQueuedMessagesService(app);
  registerMessagesService(app);
  return app;
}

let app;
let userId;
let sessionId;
let primaryId;
let handleMessageCreated;

async function insertSubagent(fields) {
  const primary = await db('agents').where({ id: primaryId }).first();
  const [id] = await db('agents').insert({
    session_id: sessionId,
    ref: fields.ref ?? 2,
    name: fields.name ?? 'Helper',
    agent_type: 'subagent',
    is_primary: 0,
    status: fields.status ?? 'running',
    agent_config_id: primary.agent_config_id,
    agent_sdk: 'claude',
    model: 'sonnet',
    current_turn_id: 0,
    parent_agent_id: fields.parent_agent_id ?? primaryId,
  });
  if (fields.observed) {
    await insertAgentObserver(db, { agentId: id, observerAgentId: fields.observed });
  }
  return id;
}

const agentRow = async (id) => db('agents').where({ id }).first();

beforeEach(async () => {
  handleMessageCreated = vi.fn().mockResolvedValue(undefined);
  await db('users').insert({ github_id: 701, username: 'hold-tester', status: 'approved' });
  const user = await db('users').where({ username: 'hold-tester' }).first();
  userId = user.id;

  await db('repos').insert({ full_name: 'test/hold-repo', repo_path: '/tmp/hold-repo' });
  const repo = await db('repos').where({ full_name: 'test/hold-repo' }).first();

  sessionId = await insertTestSession(db, {
    user_id: userId,
    repo_id: repo.id,
    repo_full_name: 'test/hold-repo',
    base_branch: 'main',
    short_id: 'hold01',
    initial_prompt: 'Hold test',
    status: 'stopped',
  });
  primaryId = await db('agents')
    .where({ session_id: sessionId, is_primary: 1 })
    .first()
    .then((r) => r.id);
  await db('agents').where({ id: primaryId }).update({ status: 'running', current_turn_id: 1 });

  app = makeApp(db, { handleMessageCreated });
  await app.setup();
});

describe('agent_observers wake-ups', () => {
  it('posts a wake message with the result when the subagent completes', async () => {
    const childId = await insertSubagent({ ref: 2, observed: primaryId });
    await db('session_messages').insert({
      session_id: sessionId,
      agent_id: childId,
      turn_id: 1,
      type: 'assistant',
      message_json: JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'All done, tests pass.' }] },
      }),
      agent_sdk: 'claude',
      model: 'sonnet',
    });

    await setAgentTurnTerminal(app, { id: childId }, userId, 'completed');

    expect((await agentRow(primaryId)).status).toBe('running');

    const rows = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(rows).toHaveLength(1);
    const payload = parseUserPayload(rows[0]);
    expect(rows[0].agent_id).toBe(primaryId);
    expect(payload.title).toBe('Subagent Helper finished');
    expect(payload.content).toContain('finished with status completed');
    expect(payload.content).toContain('All done, tests pass.');
    expect(handleMessageCreated).toHaveBeenCalledTimes(1);
  });

  it('notifies the parent when the subagent turn failed', async () => {
    const childId = await insertSubagent({ ref: 3, name: 'Flaky', observed: primaryId });
    await setAgentTurnTerminal(app, { id: childId }, userId, 'failed');

    const rows = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(rows).toHaveLength(1);
    expect(parseUserPayload(rows[0]).content).toContain(
      'Subagent #3 "Flaky" finished with status failed'
    );
  });

  it('does not notify when the agent has no observer rows', async () => {
    const childId = await insertSubagent({ ref: 4 });
    await setAgentTurnTerminal(app, { id: childId }, userId, 'completed');
    const rows = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(rows).toHaveLength(0);
    expect(handleMessageCreated).not.toHaveBeenCalled();
  });

  it('completes the parent immediately even while a watched child is still running', async () => {
    await insertSubagent({ ref: 2, observed: primaryId });
    await setAgentTurnTerminal(app, { id: primaryId }, userId, 'completed');
    expect((await agentRow(primaryId)).status).toBe('completed');
  });

  it('does not notify on a user-stopped turn', async () => {
    const childId = await insertSubagent({ ref: 2, observed: primaryId });
    await setAgentTurnTerminal(app, { id: childId }, userId, 'stopped');
    const rows = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(rows).toHaveLength(0);
  });

  it('pings observers when the observed agent is waiting for user input', async () => {
    const childId = await insertSubagent({ ref: 2, observed: primaryId });
    await db('session_messages').insert({
      session_id: sessionId,
      agent_id: childId,
      turn_id: 1,
      type: 'assistant',
      message_json: JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'Which database?' },
      }),
      agent_sdk: 'claude',
      model: 'sonnet',
    });

    await notifyAgentObservers(app, await agentRow(childId), userId, { awaitingUser: true });

    const rows = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(rows).toHaveLength(1);
    const payload = parseUserPayload(rows[0]);
    expect(payload.title).toBe('Subagent Helper is waiting for user input');
    expect(payload.content).toContain('is waiting for user input.');
    expect(payload.content).toContain('Which database?');
  });

  it('fans out to a cross-session watcher and the subagent parent alike', async () => {
    // A second session owned by the same user; its primary builder watches this one.
    const watcherSessionId = await insertTestSession(db, {
      user_id: userId,
      repo_id: (await db('repos').where({ full_name: 'test/hold-repo' }).first()).id,
      repo_full_name: 'test/hold-repo',
      base_branch: 'main',
      short_id: 'watch1',
      label: 'Orchestrator',
      initial_prompt: 'Orchestrate',
      status: 'stopped',
    });
    const watcherAgentId = await db('agents')
      .where({ session_id: watcherSessionId, is_primary: 1 })
      .first()
      .then((r) => r.id);

    const childId = await insertSubagent({ ref: 2, observed: primaryId });
    await insertAgentObserver(db, { agentId: childId, observerAgentId: watcherAgentId });

    await setAgentTurnTerminal(app, { id: childId }, userId, 'completed');

    const sameSession = await db('session_messages')
      .where({ session_id: sessionId, type: 'user' })
      .pluck('agent_id');
    const crossSession = await db('session_messages')
      .where({ session_id: watcherSessionId, type: 'user' })
      .first();
    expect(sameSession).toEqual([primaryId]);
    expect(crossSession.agent_id).toBe(watcherAgentId);
    const payload = parseUserPayload(crossSession);
    expect(payload.title).toBe('Subagent Helper finished');
    expect(payload.content).toContain('finished with status completed');
  });

  it('reports cross-session primary-builder turn ends with the session label and path', async () => {
    const watcherSessionId = await insertTestSession(db, {
      user_id: userId,
      repo_id: (await db('repos').where({ full_name: 'test/hold-repo' }).first()).id,
      repo_full_name: 'test/hold-repo',
      base_branch: 'main',
      short_id: 'watch2',
      label: 'Orchestrator 2',
      initial_prompt: 'Orchestrate',
      status: 'stopped',
    });
    const watcherAgentId = await db('agents')
      .where({ session_id: watcherSessionId, is_primary: 1 })
      .first()
      .then((r) => r.id);
    await insertAgentObserver(db, { agentId: primaryId, observerAgentId: watcherAgentId });
    await db('sessions').where({ id: sessionId }).update({ label: 'Fix login bug' });

    await db('session_messages').insert({
      session_id: sessionId,
      agent_id: primaryId,
      turn_id: 2,
      type: 'assistant',
      message_json: JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'Shipped the fix and pushed.' },
      }),
      agent_sdk: 'claude',
      model: 'sonnet',
    });

    await setAgentTurnTerminal(app, { id: primaryId }, userId, 'completed');

    const row = await db('session_messages')
      .where({ session_id: watcherSessionId, type: 'user' })
      .first();
    const payload = parseUserPayload(row);
    expect(payload.title).toBe('Session "Fix login bug" finished');
    expect(payload.content).toContain(
      `Session "Fix login bug" (#${sessionId}) finished with status completed.`
    );
    expect(payload.content).toContain('/sessions/' + sessionId);
    expect(payload.content).toContain('Shipped the fix and pushed.');
  });

  it('skips observers whose session is archived', async () => {
    const watcherSessionId = await insertTestSession(db, {
      user_id: userId,
      repo_id: (await db('repos').where({ full_name: 'test/hold-repo' }).first()).id,
      repo_full_name: 'test/hold-repo',
      base_branch: 'main',
      short_id: 'watch3',
      label: 'Archived watcher',
      initial_prompt: 'Orchestrate',
      status: 'stopped',
    });
    const watcherAgentId = await db('agents')
      .where({ session_id: watcherSessionId, is_primary: 1 })
      .first()
      .then((r) => r.id);
    await db('sessions')
      .where({ id: watcherSessionId })
      .update({ archived_at: new Date().toISOString() });

    const childId = await insertSubagent({ ref: 2, observed: primaryId });
    await insertAgentObserver(db, { agentId: childId, observerAgentId: watcherAgentId });

    await setAgentTurnTerminal(app, { id: childId }, userId, 'completed');

    const rows = await db('session_messages').where({ session_id: watcherSessionId, type: 'user' });
    expect(rows).toHaveLength(0);
  });

  it('consumes notify_on once rows after the first notification', async () => {
    const childId = await insertSubagent({ ref: 2 });
    await insertAgentObserver(db, {
      agentId: childId,
      observerAgentId: primaryId,
      notifyOn: 'once',
    });

    await setAgentTurnTerminal(app, { id: childId }, userId, 'completed');
    await setAgentTurnTerminal(app, { id: childId }, userId, 'completed');

    const rows = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(rows).toHaveLength(1);
    const remaining = await db('agent_observers').where({ agent_id: childId });
    expect(remaining).toHaveLength(0);
  });

  it('includes the queued message count in the wake message', async () => {
    const childId = await insertSubagent({ ref: 2, observed: primaryId });
    await db('queued_messages').insert({
      session_id: sessionId,
      user_id: userId,
      agent_id: childId,
      kind: 'turn',
      message_json: JSON.stringify({ content: 'follow-up' }),
    });

    await setAgentTurnTerminal(app, { id: childId }, userId, 'completed');

    const row = await db('session_messages').where({ session_id: sessionId, type: 'user' }).first();
    expect(parseUserPayload(row).content).toContain('1 queued message');
  });

  it('insertAgentObserver is idempotent per pair and validates notify_on', async () => {
    const childId = await insertSubagent({ ref: 2 });
    const first = await insertAgentObserver(db, { agentId: childId, observerAgentId: primaryId });
    const second = await insertAgentObserver(db, { agentId: childId, observerAgentId: primaryId });
    expect(first).toBe(second);
    const rows = await db('agent_observers').where({ agent_id: childId });
    expect(rows).toHaveLength(1);

    await expect(
      insertAgentObserver(db, { agentId: childId, observerAgentId: primaryId, notifyOn: 'weekly' })
    ).rejects.toThrow('notify_on');
  });

  it('insertAgentObserver rejects a self-watch', async () => {
    await expect(
      insertAgentObserver(db, { agentId: primaryId, observerAgentId: primaryId })
    ).rejects.toThrow('cannot observe itself');
  });

  it('insertAgentObserver rejects a mutual watch (direct 2-cycle)', async () => {
    const watcherSessionId = await insertTestSession(db, {
      user_id: userId,
      repo_id: (await db('repos').where({ full_name: 'test/hold-repo' }).first()).id,
      repo_full_name: 'test/hold-repo',
      base_branch: 'main',
      short_id: 'cyclo1',
      label: 'Cycle watcher',
      initial_prompt: 'Watch',
      status: 'stopped',
    });
    const watcherAgentId = await db('agents')
      .where({ session_id: watcherSessionId, is_primary: 1 })
      .first()
      .then((r) => r.id);

    // Session 1's builder is observed by the watcher session's builder ...
    await insertAgentObserver(db, { agentId: primaryId, observerAgentId: watcherAgentId });
    // ... so the reverse watch must be rejected.
    await expect(
      insertAgentObserver(db, { agentId: watcherAgentId, observerAgentId: primaryId })
    ).rejects.toThrow('wake-up loop');
  });

  it('insertAgentObserver rejects a transitive 3-cycle', async () => {
    const repo = await db('repos').where({ full_name: 'test/hold-repo' }).first();
    const primaries = [];
    for (const [shortId, label] of [
      ['cycA1', 'Cycle A'],
      ['cycB1', 'Cycle B'],
      ['cycC1', 'Cycle C'],
    ]) {
      const sessionId = await insertTestSession(db, {
        user_id: userId,
        repo_id: repo.id,
        repo_full_name: 'test/hold-repo',
        base_branch: 'main',
        short_id: shortId,
        label,
        initial_prompt: 'Watch',
        status: 'stopped',
      });
      primaries.push(
        await db('agents')
          .where({ session_id: sessionId, is_primary: 1 })
          .first()
          .then((r) => r.id)
      );
    }
    const [p1, p2, p3] = primaries;
    await insertAgentObserver(db, { agentId: p1, observerAgentId: p2 });
    await insertAgentObserver(db, { agentId: p2, observerAgentId: p3 });
    // p1 → p2 → p3 already exists, so p3 → p1 closes the cycle.
    await expect(insertAgentObserver(db, { agentId: p3, observerAgentId: p1 })).rejects.toThrow(
      'wake-up loop'
    );
  });

  it('fan-out skips a legacy self-observer row instead of looping', async () => {
    await db('agent_observers').insert({
      agent_id: primaryId,
      observer_agent_id: primaryId,
      notify_on: 'turn_end',
    });

    await setAgentTurnTerminal(app, { id: primaryId }, userId, 'completed');

    const rows = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(rows).toHaveLength(0);
  });

  describe('partial fan-out failures', () => {
    /** Create an independent watcher session observing `observedAgentId`. */
    async function insertWatcher(shortId, observedAgentId, { notifyOn } = {}) {
      const watcherSessionId = await insertTestSession(db, {
        user_id: userId,
        repo_id: (await db('repos').where({ full_name: 'test/hold-repo' }).first()).id,
        repo_full_name: 'test/hold-repo',
        base_branch: 'main',
        short_id: shortId,
        label: `Watcher ${shortId}`,
        initial_prompt: 'Watch',
        status: 'stopped',
      });
      const watcherAgentId = await db('agents')
        .where({ session_id: watcherSessionId, is_primary: 1 })
        .first()
        .then((r) => r.id);
      const rowId = await insertAgentObserver(db, {
        agentId: observedAgentId,
        observerAgentId: watcherAgentId,
        ...(notifyOn ? { notifyOn } : {}),
      });
      return { watcherSessionId, watcherAgentId, rowId };
    }

    function failDeliveryFor(sessionIds) {
      const failing = new Set(sessionIds);
      const messagesService = app.service('messages');
      const realCreate = messagesService.create.bind(messagesService);
      messagesService.create = (data, params) => {
        if (failing.has(data.session_id)) {
          return Promise.reject(new Error('delivery boom'));
        }
        return realCreate(data, params);
      };
      return () => {
        messagesService.create = realCreate;
      };
    }

    it('a failing observer does not abort fan-out to the others', async () => {
      const childId = await insertSubagent({ ref: 2, observed: primaryId });
      const failing = await insertWatcher('wfail1', childId);
      const healthy = await insertWatcher('wok01', childId);
      const restore = failDeliveryFor([failing.watcherSessionId]);

      await expect(
        notifyAgentObservers(app, await agentRow(childId), userId, { status: 'completed' })
      ).resolves.toBeUndefined();
      restore();

      const healthyRows = await db('session_messages').where({
        session_id: healthy.watcherSessionId,
        type: 'user',
      });
      expect(healthyRows).toHaveLength(1);
      const failingRows = await db('session_messages').where({
        session_id: failing.watcherSessionId,
        type: 'user',
      });
      expect(failingRows).toHaveLength(0);
    });

    it('once rows are consumed only when delivered — failed delivery retries', async () => {
      const childId = await insertSubagent({ ref: 2, observed: primaryId });
      const failing = await insertWatcher('wfail2', childId, { notifyOn: 'once' });
      const healthy = await insertWatcher('wok02', childId, { notifyOn: 'once' });
      const restore = failDeliveryFor([failing.watcherSessionId]);

      await notifyAgentObservers(app, await agentRow(childId), userId, { status: 'completed' });
      restore();

      // Delivered watcher: got the ping and its once row is consumed.
      expect(
        await db('session_messages').where({ session_id: healthy.watcherSessionId, type: 'user' })
      ).toHaveLength(1);
      expect(await db('agent_observers').where({ id: healthy.rowId })).toHaveLength(0);
      // Failed watcher: no ping, once row survives for a retry.
      expect(
        await db('session_messages').where({ session_id: failing.watcherSessionId, type: 'user' })
      ).toHaveLength(0);
      expect(await db('agent_observers').where({ id: failing.rowId })).toHaveLength(1);

      // Retry delivers the failed watcher exactly once — the healthy watcher is not pinged again.
      await notifyAgentObservers(app, await agentRow(childId), userId, { status: 'completed' });
      expect(
        await db('session_messages').where({ session_id: failing.watcherSessionId, type: 'user' })
      ).toHaveLength(1);
      expect(await db('agent_observers').where({ id: failing.rowId })).toHaveLength(0);
      expect(
        await db('session_messages').where({ session_id: healthy.watcherSessionId, type: 'user' })
      ).toHaveLength(1);
    });
  });
});
