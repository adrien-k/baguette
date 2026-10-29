/**
 * The slack-threads service: Slack thread ↔ session bindings.
 */
import { getServiceOptions } from '@feathersjs/feathers';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import {
  insertAssistantMessage,
  insertSession,
  insertSlackApp,
  insertThread,
  insertUser,
  slackTestApp,
} from './slack-test-helpers.js';

const db = createTestDb();
const threads = () => slackTestApp(db).service('slack-threads');

async function setup() {
  const userId = await insertUser(db);
  const appId = await insertSlackApp(db);
  return { userId, appId };
}

const bind = (appId, userId, sessionId, extra = {}) =>
  threads().bind({
    slackAppId: appId,
    channelId: 'C1',
    threadTs: '9.9',
    sessionId,
    userId,
    ...extra,
  });

describe('active', () => {
  it('is null for a thread that was never bound', async () => {
    const { appId } = await setup();
    expect(await threads().active(appId, 'C1', '9.9')).toBeNull();
  });

  it('returns the newest binding', async () => {
    const { userId, appId } = await setup();
    const first = await insertSession(db, userId);
    const second = await insertSession(db, userId);
    await bind(appId, userId, first);
    await bind(appId, userId, second);
    expect((await threads().active(appId, 'C1', '9.9')).session_id).toBe(second);
  });

  it('is null once the bound session is archived', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertSession(db, userId);
    await bind(appId, userId, sessionId);
    await db('sessions').where({ id: sessionId }).update({ archived_at: new Date().toISOString() });
    expect(await threads().active(appId, 'C1', '9.9')).toBeNull();
  });

  it('keeps threads, channels and apps apart', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertSession(db, userId);
    await bind(appId, userId, sessionId);
    expect(await threads().active(appId, 'C1', '1.1')).toBeNull();
    expect(await threads().active(appId, 'C2', '9.9')).toBeNull();
    expect(await threads().active(appId + 1, 'C1', '9.9')).toBeNull();
  });
});

describe('bind', () => {
  it('re-binding the same session replaces its row and makes it the newest', async () => {
    const { userId, appId } = await setup();
    const first = await insertSession(db, userId);
    const second = await insertSession(db, userId);
    await bind(appId, userId, first);
    await bind(appId, userId, second);
    await bind(appId, userId, first, { lastPostedMessageId: 4 });

    const rows = await db('slack_threads').orderBy('id');
    expect(rows.map((r) => r.session_id)).toEqual([second, first]);
    expect(rows[1].last_posted_message_id).toBe(4);
  });

  it('keeps the existing binding when the insert fails', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertSession(db, userId);
    await bind(appId, userId, sessionId, { lastPostedMessageId: 3 });

    await expect(bind(appId, null, sessionId)).rejects.toThrow();

    const rows = await db('slack_threads');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ session_id: sessionId, last_posted_message_id: 3 });
  });

  it('survives concurrent binds of the same session and thread', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertSession(db, userId);

    await Promise.all([
      bind(appId, userId, sessionId),
      bind(appId, userId, sessionId),
      bind(appId, userId, sessionId),
    ]);

    expect(await db('slack_threads')).toHaveLength(1);
  });
});

describe('attach', () => {
  it('binds a new session to the thread of the session that spawned it', async () => {
    const { userId, appId } = await setup();
    const parent = await insertSession(db, userId);
    const child = await insertSession(db, userId);
    await insertThread(db, { slack_app_id: appId, session_id: parent, user_id: userId });

    await threads().attach(parent, child);

    const active = await threads().active(appId, 'C1', '9.9');
    expect(active).toMatchObject({ session_id: child, user_id: userId });
    expect(await db('slack_threads')).toHaveLength(2);
  });

  it('does nothing for a session that is not in a Slack thread, or without a parent', async () => {
    const { userId } = await setup();
    const loose = await insertSession(db, userId);
    const child = await insertSession(db, userId);
    await threads().attach(loose, child);
    await threads().attach(null, child);
    await threads().attach(undefined, child);
    expect(await db('slack_threads')).toHaveLength(0);
  });
});

describe('switchTo', () => {
  it('skips the session’s old replies', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertSession(db, userId);
    await insertAssistantMessage(db, sessionId, 'old');
    const last = await insertAssistantMessage(db, sessionId, 'older still');

    await threads().switchTo({
      slackAppId: appId,
      channelId: 'C1',
      threadTs: '9.9',
      session: await db('sessions').where({ id: sessionId }).first(),
      userId,
    });

    expect(await threads().active(appId, 'C1', '9.9')).toMatchObject({
      session_id: sessionId,
      last_posted_message_id: last,
    });
  });

  it('starts from zero for a session without replies', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertSession(db, userId);
    await threads().switchTo({
      slackAppId: appId,
      channelId: 'C1',
      threadTs: '9.9',
      session: await db('sessions').where({ id: sessionId }).first(),
      userId,
    });
    expect((await threads().active(appId, 'C1', '9.9')).last_posted_message_id).toBe(0);
  });
});

describe('switchTo: the sessions the thread leaves', () => {
  const switchTo = async (appId, userId, sessionId, threadTs = '9.9') =>
    threads().switchTo({
      slackAppId: appId,
      channelId: 'C1',
      threadTs,
      session: await db('sessions').where({ id: sessionId }).first(),
      userId,
    });

  it('returns the session that was active, and lets every older binding of the thread go', async () => {
    const { userId, appId } = await setup();
    const closed = await insertSession(db, userId);
    const active = await insertSession(db, userId);
    const target = await insertSession(db, userId);
    await bind(appId, userId, closed);
    await bind(appId, userId, active);

    expect(await switchTo(appId, userId, target)).toBe(active);
    const rows = await db('slack_threads');
    expect(rows.map((r) => r.session_id)).toEqual([target]);
  });

  it('returns null when the thread had no session, or the same one', async () => {
    const { userId, appId } = await setup();
    const target = await insertSession(db, userId);
    expect(await switchTo(appId, userId, target)).toBeNull();
    expect(await switchTo(appId, userId, target)).toBeNull();
    expect(await db('slack_threads')).toHaveLength(1);
  });

  it('does not touch other threads of the old session, or other sessions’ threads', async () => {
    const { userId, appId } = await setup();
    const old = await insertSession(db, userId);
    const target = await insertSession(db, userId);
    await bind(appId, userId, old);
    await threads().bind({
      slackAppId: appId,
      channelId: 'C2',
      threadTs: '1.1',
      sessionId: old,
      userId,
    });
    await switchTo(appId, userId, target);
    const rows = await db('slack_threads').orderBy('id');
    expect(rows.map((r) => [r.channel_id, r.thread_ts, r.session_id])).toEqual([
      ['C2', '1.1', old],
      ['C1', '9.9', target],
    ]);
  });
});

describe('forSession / latestForSession', () => {
  it('lists every thread a session serves, and the newest binding', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertSession(db, userId);
    await bind(appId, userId, sessionId);
    await threads().bind({
      slackAppId: appId,
      channelId: 'C2',
      threadTs: '1.1',
      sessionId,
      userId,
    });

    expect((await threads().forSession(sessionId)).map((r) => r.channel_id).sort()).toEqual([
      'C1',
      'C2',
    ]);
    expect((await threads().latestForSession(sessionId)).channel_id).toBe('C2');
    expect(await threads().latestForSession(99999)).toBeNull();
    expect(await threads().forSession(99999)).toEqual([]);
  });
});

describe('setLoader / markPosted', () => {
  it('remembers the loader message and how far replies were posted', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertSession(db, userId);
    await bind(appId, userId, sessionId);
    const [row] = await threads().forSession(sessionId);

    await threads().setLoader(row.id, '20.1');
    await threads().markPosted(row.id, { messageId: 7 });
    expect(await db('slack_threads').where({ id: row.id }).first()).toMatchObject({
      status_ts: '20.1',
      last_posted_message_id: 7,
    });

    await threads().setLoader(row.id, null);
    await threads().markPosted(row.id, { messageId: 9 });
    expect(await db('slack_threads').where({ id: row.id }).first()).toMatchObject({
      status_ts: null,
      last_posted_message_id: 9,
    });
  });
});

describe('approvals of other Slack users', () => {
  const approvals = async (sessionId) =>
    JSON.parse((await db('sessions').where({ id: sessionId }).first()).slack_approvals);

  it('have no status until requested', async () => {
    const { userId } = await setup();
    const sessionId = await insertSession(db, userId);
    expect(await threads().approvalStatus(sessionId, 'UEVA')).toBeNull();
    expect(await threads().approvalStatus(99999, 'UEVA')).toBeNull();
  });

  it('are requested once: pending, with the owner remembered', async () => {
    const { userId } = await setup();
    const sessionId = await insertSession(db, userId);
    expect(await threads().requestApproval(sessionId, 'UEVA', 'UOWNER')).toBe(true);
    expect(await threads().requestApproval(sessionId, 'UEVA', 'UOWNER')).toBe(false);
    expect(await threads().approvalStatus(sessionId, 'UEVA')).toBe('pending');
    expect((await db('sessions').where({ id: sessionId }).first()).slack_owner).toBe('UOWNER');
  });

  it('are kept per user and per session', async () => {
    const { userId } = await setup();
    const one = await insertSession(db, userId);
    const two = await insertSession(db, userId);
    await threads().requestApproval(one, 'UEVA', 'UOWNER');
    await threads().requestApproval(one, 'UTOM', 'UOWNER');
    await threads().resolveApproval(one, 'UEVA', true);
    expect(await approvals(one)).toEqual({ UEVA: 'approved', UTOM: 'pending' });
    expect(await threads().approvalStatus(two, 'UEVA')).toBeNull();
  });

  it('are approved or rejected once, only from pending', async () => {
    const { userId } = await setup();
    const sessionId = await insertSession(db, userId);
    expect(await threads().resolveApproval(sessionId, 'UEVA', true)).toBe(false); // never asked
    await threads().requestApproval(sessionId, 'UEVA', 'UOWNER');
    expect(await threads().resolveApproval(sessionId, 'UEVA', false)).toBe(true);
    expect(await threads().approvalStatus(sessionId, 'UEVA')).toBe('rejected');
    // A second click, or a later request, changes nothing.
    expect(await threads().resolveApproval(sessionId, 'UEVA', true)).toBe(false);
    expect(await threads().requestApproval(sessionId, 'UEVA', 'UOWNER')).toBe(false);
    expect(await threads().approvalStatus(sessionId, 'UEVA')).toBe('rejected');
  });

  it('survive concurrent requests: exactly one asks', async () => {
    const { userId } = await setup();
    const sessionId = await insertSession(db, userId);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => threads().requestApproval(sessionId, 'UEVA', 'UOWNER'))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('as a service', () => {
  it('exposes no method to clients', () => {
    expect(getServiceOptions(threads()).methods).toEqual([]);
  });
});
