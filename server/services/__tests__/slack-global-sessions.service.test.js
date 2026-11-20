/**
 * The slack-global-sessions service: global session sessions, the threads they serve, who they listen to.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';

const sessionTool = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../mcp/tools/create-session.js', () => ({ createCreateSessionTool: sessionTool.create }));

import { encrypt } from '../../lib/encrypt.js';
import {
  decryptedApp,
  insertGlobalSession,
  insertSlackApp,
  insertThread,
  insertUser,
  linkSlackUser,
  slackTestApp,
} from './slack-test-helpers.js';

const db = createTestDb();
const globalSessions = () => slackTestApp(db).service('slack-global-sessions');

async function setup() {
  const userId = await insertUser(db);
  const appId = await insertSlackApp(db);
  return { userId, appId, user: { id: userId }, slackApp: decryptedApp({ id: appId }) };
}

/** A CreateSession stand-in that creates the global session row, or fails with `error`. */
function stubCreateSession({ error = null } = {}) {
  const calls = [];
  sessionTool.create.mockImplementation((context) => ({
    handler: async (args) => {
      calls.push({ context, args });
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (error) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error }) }] };
      const sessionId = await insertGlobalSession(db, context.userId, context.slackAppId);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, sessionId }) }] };
    },
  }));
  return calls;
}

beforeEach(() => sessionTool.create.mockReset());

describe('findForUser', () => {
  it('finds the live global session of a user in an app, and nothing else', async () => {
    const { userId, appId } = await setup();
    expect(await globalSessions().findForUser(appId, userId)).toBeNull();

    const sessionId = await insertGlobalSession(db, userId, appId);
    expect((await globalSessions().findForUser(appId, userId)).id).toBe(sessionId);
    expect(await globalSessions().findForUser(appId + 1, userId)).toBeNull();
    expect(await globalSessions().findForUser(appId, userId + 1)).toBeNull();
  });

  it('ignores an archived global session', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertGlobalSession(db, userId, appId);
    await db('sessions').where({ id: sessionId }).update({ archived_at: new Date().toISOString() });
    expect(await globalSessions().findForUser(appId, userId)).toBeNull();
  });
});

describe('ensure', () => {
  it('creates the global session through CreateSession as a global session typed with the app', async () => {
    const { user, slackApp, appId } = await setup();
    const calls = stubCreateSession();
    const meta = { source: 'slack' };

    const { session, created } = await globalSessions().ensure({
      slackApp,
      user,
      prompt: 'first message',
      messageMeta: meta,
    });

    expect(created).toBe(true);
    expect(session.slack_app_id).toBe(appId);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual({ is_global: true, initial_prompt: 'first message' });
    expect(calls[0].context.resolveBuilderModel).toBeTypeOf('function');
    expect(calls[0].context).toMatchObject({
      slackAppId: appId,
      initialMessageMeta: meta,
      initialLabel: 'Slack global session',
    });
  });

  it('returns the existing global session without creating another', async () => {
    const { user, slackApp, userId, appId } = await setup();
    const existing = await insertGlobalSession(db, userId, appId);
    const calls = stubCreateSession();
    const { session, created } = await globalSessions().ensure({ slackApp, user, prompt: 'x' });
    expect(created).toBe(false);
    expect(session.id).toBe(existing);
    expect(calls).toHaveLength(0);
  });

  it('creates only one global session when two first messages race', async () => {
    const { user, slackApp } = await setup();
    const calls = stubCreateSession();
    const service = globalSessions();
    const [a, b] = await Promise.all([
      service.ensure({ slackApp, user, prompt: 'one' }),
      service.ensure({ slackApp, user, prompt: 'two' }),
    ]);
    expect(calls).toHaveLength(1);
    expect(a.session.id).toBe(b.session.id);
  });

  it('fails with the tool’s message (for example no default model in Settings)', async () => {
    const { user, slackApp } = await setup();
    stubCreateSession({ error: 'No default builder model. Set one in Settings → Agent.' });
    await expect(globalSessions().ensure({ slackApp, user, prompt: 'x' })).rejects.toThrow(
      'Settings → Agent'
    );
    // …and a later message can try again.
    stubCreateSession();
    expect((await globalSessions().ensure({ slackApp, user, prompt: 'x' })).created).toBe(true);
  });
});

describe('threads', () => {
  it('finds the live global sessions serving a thread, per app', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertGlobalSession(db, userId, appId);
    await insertThread(db, sessionId);

    expect((await globalSessions().forThread(appId, 'C1', '9.9')).map((s) => s.id)).toEqual([
      sessionId,
    ]);
    expect(await globalSessions().forThread(appId, 'C1', '1.1')).toEqual([]);
    expect(await globalSessions().forThread(appId, 'C2', '9.9')).toEqual([]);
    expect(await globalSessions().forThread(appId + 1, 'C1', '9.9')).toEqual([]);
  });

  it('stops serving a thread once the global session is archived', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertGlobalSession(db, userId, appId);
    await insertThread(db, sessionId);
    await db('sessions').where({ id: sessionId }).update({ archived_at: new Date().toISOString() });
    expect(await globalSessions().forThread(appId, 'C1', '9.9')).toEqual([]);
  });

  it('lets two owners’ global sessions serve the same thread', async () => {
    const { userId, appId } = await setup();
    const otherUser = await insertUser(db);
    const mine = await insertGlobalSession(db, userId, appId);
    const theirs = await insertGlobalSession(db, otherUser, appId);
    await insertThread(db, mine);
    await insertThread(db, theirs);
    expect(await globalSessions().forThread(appId, 'C1', '9.9')).toHaveLength(2);
  });

  it('joining a thread twice is harmless', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertGlobalSession(db, userId, appId);
    await globalSessions().joinThread(sessionId, 'C1', '9.9');
    await globalSessions().joinThread(sessionId, 'C1', '9.9');
    expect(await db('slack_session_threads')).toHaveLength(1);
  });

  it('knows which channels a global session serves', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertGlobalSession(db, userId, appId);
    await insertThread(db, sessionId);
    expect(await globalSessions().servesChannel(sessionId, 'C1')).toBe(true);
    expect(await globalSessions().servesChannel(sessionId, 'C2')).toBe(false);
  });
});

describe('allowed people', () => {
  it('starts with nobody and replaces the list as a whole', async () => {
    const { userId, appId } = await setup();
    const sessionId = await insertGlobalSession(db, userId, appId);
    expect(await globalSessions().allowedSlackIds(sessionId)).toEqual([]);

    await globalSessions().setAllowedSlackIds(sessionId, ['U2', 'U3', 'U2']);
    expect((await globalSessions().allowedSlackIds(sessionId)).sort()).toEqual(['U2', 'U3']);
    expect(await globalSessions().isAllowed(sessionId, 'U2')).toBe(true);

    await globalSessions().setAllowedSlackIds(sessionId, ['U3']);
    expect(await globalSessions().allowedSlackIds(sessionId)).toEqual(['U3']);
    expect(await globalSessions().isAllowed(sessionId, 'U2')).toBe(false);

    await globalSessions().setAllowedSlackIds(sessionId, []);
    expect(await globalSessions().allowedSlackIds(sessionId)).toEqual([]);
  });

  it('keeps each global session’s list apart', async () => {
    const { userId, appId } = await setup();
    const other = await insertUser(db);
    const mine = await insertGlobalSession(db, userId, appId);
    const theirs = await insertGlobalSession(db, other, appId);
    await globalSessions().setAllowedSlackIds(mine, ['U2']);
    expect(await globalSessions().isAllowed(theirs, 'U2')).toBe(false);
  });
});

describe('owner and repository scope', () => {
  it('finds the Slack id a Baguette user linked', async () => {
    const { userId, appId } = await setup();
    expect(await globalSessions().slackIdOf(appId, userId)).toBeNull();
    await linkSlackUser(db, appId, 'UOWNER', userId);
    expect(await globalSessions().slackIdOf(appId, userId)).toBe('UOWNER');
  });

  it('limits repositories only when the app lists some', async () => {
    const { appId } = await setup();
    expect(await globalSessions().repoScope(appId)).toBeNull();

    await db('slack_apps').where({ id: appId }).update({ allowed_repo_ids: '[3,5]' });
    expect(await globalSessions().repoScope(appId)).toEqual([3, 5]);

    await db('slack_apps').where({ id: appId }).update({ allowed_repo_ids: '[]' });
    expect(await globalSessions().repoScope(appId)).toBeNull();
    await db('slack_apps').where({ id: appId }).update({ allowed_repo_ids: 'garbage' });
    expect(await globalSessions().repoScope(appId)).toBeNull();
  });

  it('is not influenced by other apps', async () => {
    const { appId } = await setup();
    const other = await insertSlackApp(db, { bot_token_encrypted: encrypt('x') });
    await db('slack_apps').where({ id: other }).update({ allowed_repo_ids: '[1]' });
    expect(await globalSessions().repoScope(appId)).toBeNull();
  });
});
