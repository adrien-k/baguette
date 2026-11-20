/**
 * The Slack side of a session: who owns an assistant and who it listens to.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';

const slack = vi.hoisted(() => ({ getUserInfo: vi.fn(), listUsers: vi.fn() }));
vi.mock('../slack.js', async (importOriginal) => ({ ...(await importOriginal()), ...slack }));

import { SessionsService } from '../feathers/sessions.service.js';
import { resetSlackUserCache } from '../slack-users.js';
import {
  decryptedApp,
  insertAssistant,
  insertSession,
  insertSlackApp,
  insertUser,
  linkSlackUser,
  slackTestApp,
} from './slack-test-helpers.js';

const db = createTestDb();

const PEOPLE = {
  UOWNER: { id: 'UOWNER', name: 'jan', profile: { display_name: 'jan' } },
  UEVA: { id: 'UEVA', name: 'eva', profile: { display_name: 'eva' } },
};

async function setup() {
  const userId = await insertUser(db);
  const appId = await insertSlackApp(db, { team_name: 'Acme' });
  await linkSlackUser(db, appId, 'UOWNER', userId);
  const sessionId = await insertAssistant(db, userId, appId);
  const real = slackTestApp(db);
  const slackApp = decryptedApp({ id: appId, team_name: 'Acme' });
  const app = {
    get: () => db,
    service: (name) =>
      name === 'admin/slack' ? { get: async () => slackApp } : real.service(name),
  };
  const service = Object.create(SessionsService.prototype);
  service.app = app;
  const resolvedSession = await db('sessions').where({ id: sessionId }).first();
  return {
    service,
    userId,
    appId,
    sessionId,
    resolvedSession,
    assistants: real.service('slack-assistants'),
  };
}

beforeEach(() => {
  resetSlackUserCache();
  slack.getUserInfo.mockReset().mockImplementation(async (_token, id) => PEOPLE[id]);
  slack.listUsers.mockReset().mockResolvedValue(Object.values(PEOPLE));
});

describe('sessionSlack', () => {
  it('is not linked for an ordinary session', async () => {
    const { service, userId } = await setup();
    const id = await insertSession(db, userId);
    const resolvedSession = await db('sessions').where({ id }).first();
    expect(await service.sessionSlack({}, { resolvedSession })).toEqual({ linked: false });
  });

  it('names the workspace, the owner and the allowed people', async () => {
    const { service, resolvedSession, assistants, sessionId } = await setup();
    await assistants.setAllowedSlackIds(sessionId, ['UEVA']);
    const out = await service.sessionSlack({}, { resolvedSession });
    expect(out).toMatchObject({ linked: true, workspace: 'Acme' });
    expect(out.owner).toContain('jan');
    expect(out.allowed).toHaveLength(1);
    expect(out.allowed[0]).toContain('eva');
  });
});

describe('setSlackAllowedUsers', () => {
  it('lets the owner replace who the assistant listens to', async () => {
    const { service, resolvedSession, userId, assistants, sessionId } = await setup();
    const out = await service.setSlackAllowedUsers(
      { usernames: ['eva'] },
      { resolvedSession, user: { id: userId } }
    );
    expect(await assistants.allowedSlackIds(sessionId)).toEqual(['UEVA']);
    expect(out.allowed).toHaveLength(1);
  });

  it('never lists the owner as an allowed person', async () => {
    const { service, resolvedSession, userId, assistants, sessionId } = await setup();
    await service.setSlackAllowedUsers(
      { usernames: ['jan', 'eva'] },
      { resolvedSession, user: { id: userId } }
    );
    expect(await assistants.allowedSlackIds(sessionId)).toEqual(['UEVA']);
  });

  it('refuses anyone but the owner', async () => {
    const { service, resolvedSession, userId } = await setup();
    await expect(
      service.setSlackAllowedUsers(
        { usernames: ['eva'] },
        { resolvedSession, user: { id: userId + 1 } }
      )
    ).rejects.toThrow(/Only the session owner/);
  });

  it('rejects names it cannot find in Slack', async () => {
    const { service, resolvedSession, userId, assistants, sessionId } = await setup();
    await expect(
      service.setSlackAllowedUsers(
        { usernames: ['ghost'] },
        { resolvedSession, user: { id: userId } }
      )
    ).rejects.toThrow(/Unknown Slack users: ghost/);
    expect(await assistants.allowedSlackIds(sessionId)).toEqual([]);
  });

  it('only applies to Slack assistants', async () => {
    const { service, userId } = await setup();
    const id = await insertSession(db, userId);
    const resolvedSession = await db('sessions').where({ id }).first();
    await expect(
      service.setSlackAllowedUsers({ usernames: [] }, { resolvedSession, user: { id: userId } })
    ).rejects.toThrow(/not a Slack assistant/);
  });
});
