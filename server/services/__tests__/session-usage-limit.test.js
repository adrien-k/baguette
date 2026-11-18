/**
 * Usage limits: sessions.onUsageLimit applies the session's usage_limit_action —
 * stop persists a notice only; wait also schedules a resume after the reset.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerQueuedMessagesService } from '../feathers/queued-messages.service.js';
import { useClaudeAgentStub } from '../../test-utils/agent-sdks.js';
import { RESUME_MARGIN_MAX_MS, RESUME_MARGIN_MIN_MS } from '../../lib/usage-limit.js';

vi.mock('../baguette-config.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadBaguetteConfig: vi.fn().mockResolvedValue(null),
}));

const db = createTestDb();
const onMessageCreated = vi.fn().mockResolvedValue(undefined);

let app;
let userId;
let sessionId;
let agentId;

async function setPolicy(patch) {
  await db('sessions').where({ id: sessionId }).update(patch);
}

const hit = (resetInMs = 3_600_000) => ({
  label: 'Claude',
  sdk: 'claude',
  reason: 'rejected',
  reset_at_ms: Date.now() + resetInMs,
});

beforeEach(async () => {
  vi.clearAllMocks();
  await db('users').insert({ github_id: 101, username: 'alice', status: 'approved' });
  userId = (await db('users').where({ username: 'alice' }).first()).id;
  await db('repos').insert({ full_name: 'test/repo', repo_path: '/tmp/repo' });
  const repo = await db('repos').where({ full_name: 'test/repo' }).first();
  sessionId = await insertTestSession(db, {
    user_id: userId,
    repo_id: repo.id,
    repo_full_name: 'test/repo',
    base_branch: 'main',
    initial_prompt: 'Task',
    short_id: 'aa11bb',
    status: 'active',
  });
  agentId = (await db('agents').where({ session_id: sessionId, is_primary: 1 }).first()).id;

  app = feathers();
  app.set('db', db);
  registerSessionsService(app);
  registerAgentsService(app);
  useClaudeAgentStub(app, { onMessageCreated }, ['onMessageCreated']);
  registerQueuedMessagesService(app);
  registerMessagesService(app);
  await app.setup();
});

describe('sessions.onUsageLimit', () => {
  it('defaults to action stop', async () => {
    const row = await db('sessions').where({ id: sessionId }).first();
    expect(row.usage_limit_action).toBe('stop');
  });

  it('continue: stops without scheduling once the session usage limit is used up', async () => {
    await setPolicy({ usage_limit_action: 'continue' });
    const out = await app
      .service('sessions')
      .onUsageLimit(sessionId, agentId, { ...hit(), reason: 'usage_limit' });
    expect(out).toEqual({ action: 'stop', resume_at: null });
    const status = await db('session_messages')
      .where({ session_id: sessionId, type: 'system', subtype: 'status' })
      .first();
    expect(JSON.parse(status.message_json).status).toContain('session usage limit reached');
    expect(await db('queued_messages').where({ session_id: sessionId })).toHaveLength(0);
  });

  it('continue: a rejected subscription limit (overage refused too) stops without scheduling', async () => {
    await setPolicy({ usage_limit_action: 'continue' });
    const out = await app.service('sessions').onUsageLimit(sessionId, agentId, hit());
    expect(out).toEqual({ action: 'stop', resume_at: null });
    expect(await db('queued_messages').where({ session_id: sessionId })).toHaveLength(0);
  });

  it('wait: falls back to stop (and says so) when the resume cannot be scheduled', async () => {
    await setPolicy({ usage_limit_action: 'wait' });
    vi.spyOn(app.service('sessions'), 'scheduleUsageLimitResume').mockRejectedValue(
      new Error('db down')
    );
    const out = await app.service('sessions').onUsageLimit(sessionId, agentId, hit());
    expect(out).toEqual({ action: 'stop', resume_at: null });
    const status = await db('session_messages')
      .where({ session_id: sessionId, subtype: 'status' })
      .first();
    expect(JSON.parse(status.message_json).status).toContain('Session stopped');
  });

  it('wait: the chat notice says when it resumes', async () => {
    await setPolicy({ usage_limit_action: 'wait' });
    await app.service('sessions').onUsageLimit(sessionId, agentId, hit(3_600_000));
    const status = await db('session_messages')
      .where({ session_id: sessionId, subtype: 'status' })
      .first();
    expect(JSON.parse(status.message_json).status).toMatch(
      /Resumes after usage limit reset in 1h [0-9]+m\./
    );
  });

  it('stop: persists a notice and schedules nothing', async () => {
    const out = await app.service('sessions').onUsageLimit(sessionId, agentId, hit());
    expect(out).toEqual({ action: 'stop', resume_at: null });
    const status = await db('session_messages')
      .where({ session_id: sessionId, type: 'system', subtype: 'status' })
      .first();
    expect(JSON.parse(status.message_json).status).toContain('Session stopped');
    expect(await db('queued_messages').where({ session_id: sessionId })).toHaveLength(0);
  });

  it('wait: schedules a resume 1-2 minutes after the reset', async () => {
    await setPolicy({ usage_limit_action: 'wait' });
    const limit = hit();
    const out = await app.service('sessions').onUsageLimit(sessionId, agentId, limit);
    expect(out.action).toBe('wait');
    const delta = Date.parse(out.resume_at) - limit.reset_at_ms;
    expect(delta).toBeGreaterThanOrEqual(RESUME_MARGIN_MIN_MS);
    expect(delta).toBeLessThanOrEqual(RESUME_MARGIN_MAX_MS);

    const rows = await db('queued_messages').where({ session_id: sessionId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'scheduled', agent_id: agentId, send_at: out.resume_at });
    expect(JSON.parse(rows[0].message_json).message.content).toMatch(/usage limit has reset/);
  });

  it('wait: a repeated limit hit replaces the pending resume (can loop indefinitely)', async () => {
    await setPolicy({ usage_limit_action: 'wait' });
    await app.service('sessions').onUsageLimit(sessionId, agentId, hit(3_600_000));
    await app.service('sessions').onUsageLimit(sessionId, agentId, hit(7_200_000));
    expect(await db('queued_messages').where({ session_id: sessionId })).toHaveLength(1);
  });

  it('wait: the due resume is delivered as a user message', async () => {
    await setPolicy({ usage_limit_action: 'wait' });
    await app.service('sessions').onUsageLimit(sessionId, agentId, hit(1000));
    await app.service('queued-messages').runDue(Date.now() + 10 * 60_000);
    expect(await db('queued_messages').where({ session_id: sessionId })).toHaveLength(0);
    const sent = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(sent.some((m) => m.message_json.includes('usage limit has reset'))).toBe(true);
  });

  it('wait without a reset time retries after the fallback delay', async () => {
    await setPolicy({ usage_limit_action: 'wait' });
    const out = await app
      .service('sessions')
      .onUsageLimit(sessionId, agentId, { ...hit(), reset_at_ms: null });
    expect(Date.parse(out.resume_at)).toBeGreaterThan(Date.now() + 29 * 60_000);
  });
});

describe('wait backoff and cancellation', () => {
  const noReset = () => ({ ...hit(), reset_at_ms: null });

  it('backs off between retries when no reset time is known, then gives up', async () => {
    await setPolicy({ usage_limit_action: 'wait' });
    const svc = app.service('sessions');
    const delays = [];
    for (let i = 0; i < 8; i++) {
      const out = await svc.onUsageLimit(sessionId, agentId, noReset());
      expect(out.action).toBe('wait');
      delays.push(Date.parse(out.resume_at) - Date.now());
    }
    expect(delays[1]).toBeGreaterThan(delays[0] * 1.9);
    expect(delays[7]).toBeLessThan(6 * 3_600_000 + RESUME_MARGIN_MAX_MS + 5000);

    const last = await svc.onUsageLimit(sessionId, agentId, noReset());
    expect(last).toEqual({ action: 'stop', resume_at: null });
    const statuses = await db('session_messages').where({
      session_id: sessionId,
      subtype: 'status',
    });
    expect(statuses.at(-1).message_json).toContain('Gave up waiting');
  });

  it('a known reset time restarts the backoff', async () => {
    await setPolicy({ usage_limit_action: 'wait' });
    const svc = app.service('sessions');
    await svc.onUsageLimit(sessionId, agentId, noReset());
    await svc.onUsageLimit(sessionId, agentId, hit());
    const out = await svc.onUsageLimit(sessionId, agentId, noReset());
    expect(Date.parse(out.resume_at) - Date.now()).toBeLessThan(31 * 60_000 + RESUME_MARGIN_MAX_MS);
  });

  it('cancelUsageLimitResume removes the pending resume only', async () => {
    await setPolicy({ usage_limit_action: 'wait' });
    await app.service('sessions').onUsageLimit(sessionId, agentId, hit());
    await app.service('queued-messages').schedule(
      {
        session_id: sessionId,
        agent_id: agentId,
        agent_sdk: 'claude',
        model: 'claude-sonnet-4-5',
        message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'later' } }),
        send_at: new Date(Date.now() + 3_600_000).toISOString(),
      },
      { user: { id: userId } }
    );
    expect(await app.service('sessions').cancelUsageLimitResume(sessionId)).toBe(1);
    const rows = await db('queued_messages').where({ session_id: sessionId });
    expect(rows).toHaveLength(1);
    expect(rows[0].message_json).toContain('later');
  });

  it('switching the action away from wait cancels the pending resume', async () => {
    await setPolicy({ usage_limit_action: 'wait' });
    await app.service('sessions').onUsageLimit(sessionId, agentId, hit());
    await app
      .service('sessions')
      .patch(sessionId, { usage_limit_action: 'stop' }, { provider: 'rest', user: { id: userId } });
    expect(await db('queued_messages').where({ session_id: sessionId })).toHaveLength(0);
  });

  it('a user message during the wait does not cancel the resume; a new limit hit reschedules it', async () => {
    await setPolicy({ usage_limit_action: 'wait' });
    await app.service('sessions').onUsageLimit(sessionId, agentId, hit(3_600_000));
    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        agent_id: agentId,
        agent_sdk: 'claude',
        model: 'claude-sonnet-4-5',
        message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      },
      { provider: 'rest', user: { id: userId } }
    );
    expect(
      await db('queued_messages').where({ session_id: sessionId, kind: 'scheduled' })
    ).toHaveLength(1);
    // The message is rejected by the limit again: still exactly one pending resume.
    await app.service('sessions').onUsageLimit(sessionId, agentId, hit(3_000_000));
    expect(
      await db('queued_messages').where({ session_id: sessionId, kind: 'scheduled' })
    ).toHaveLength(1);
  });
});

describe('usage_limit_spent', () => {
  it('cannot be set by a client on patch', async () => {
    await db('sessions').where({ id: sessionId }).update({ usage_limit_spent: 3 });
    await app
      .service('sessions')
      .patch(
        sessionId,
        { usage_limit_spent: 0, usage_limit: 5 },
        { provider: 'rest', user: { id: userId } }
      );
    const row = await db('sessions').where({ id: sessionId }).first();
    expect(row.usage_limit_spent).toBe(3);
  });
});

describe('session usage_limit_action field', () => {
  it('accepts stop | wait | continue and rejects anything else on patch', async () => {
    const params = { provider: 'rest', user: { id: userId } };
    for (const value of ['wait', 'continue', 'stop']) {
      const patched = await app
        .service('sessions')
        .patch(sessionId, { usage_limit_action: value }, params);
      expect(patched.usage_limit_action).toBe(value);
    }
    await expect(
      app.service('sessions').patch(sessionId, { usage_limit_action: 'pause' }, params)
    ).rejects.toThrow(/usage_limit_action/);
  });

  it('stores usage_limit in dollars (lower than $1 is fine), null for unlimited', async () => {
    const params = { provider: 'rest', user: { id: userId } };
    const fresh = await db('sessions').where({ id: sessionId }).first();
    expect(fresh.usage_limit).toBeNull();
    const low = await app.service('sessions').patch(sessionId, { usage_limit: 0.25 }, params);
    expect(low.usage_limit).toBe(0.25);
    const cleared = await app.service('sessions').patch(sessionId, { usage_limit: '' }, params);
    expect(cleared.usage_limit).toBeNull();
    await expect(
      app.service('sessions').patch(sessionId, { usage_limit: -5 }, params)
    ).rejects.toThrow(/usage_limit/);
  });
});
