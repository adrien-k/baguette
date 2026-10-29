/**
 * The inbound Slack migration (075): apply, roll back and re-apply.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import Knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let db;
beforeEach(async () => {
  db = Knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: { directory },
  });
  await db.migrate.latest();
});
afterEach(() => db.destroy());

const columns = async (table) =>
  (await db.raw('select name from pragma_table_info(?)', [table])).map((c) => c.name);
const tables = async () =>
  (await db('sqlite_master').where('type', 'table').select('name')).map((t) => t.name);

const insertSession = (userId) =>
  db('sessions').insert({
    user_id: userId,
    repo_full_name: 'a/b',
    base_branch: 'main',
    initial_prompt: 'p',
  });

async function seed() {
  const [userId] = await db('users').insert({ github_id: 1, username: 'u', approved: true });
  const [appId] = await db('slack_apps').insert({ name: 'a', bot_token_encrypted: 'x' });
  return { userId, appId };
}

describe('075: inbound Slack', () => {
  it('adds the credential and install columns to slack_apps', async () => {
    expect(await columns('slack_apps')).toEqual(
      expect.arrayContaining([
        'app_token_encrypted',
        'client_id',
        'client_secret_encrypted',
        'signing_secret_encrypted',
        'api_app_id',
        'team_id',
        'team_name',
        'bot_user_id',
        'installed_at',
      ])
    );
  });

  it('adds the owner and approvals columns to sessions', async () => {
    expect(await columns('sessions')).toEqual(
      expect.arrayContaining(['slack_owner', 'slack_approvals'])
    );
  });

  it('allows one Slack user per app to be linked once', async () => {
    const { userId, appId } = await seed();
    const link = { slack_app_id: appId, slack_user_id: 'U1', user_id: userId };
    await db('slack_user_links').insert(link);
    await expect(db('slack_user_links').insert(link)).rejects.toThrow(/UNIQUE/);
  });

  it('lets a thread follow several sessions, but not the same one twice', async () => {
    const { userId, appId } = await seed();
    const [s1] = await insertSession(userId);
    const [s2] = await insertSession(userId);
    const thread = { slack_app_id: appId, channel_id: 'C1', thread_ts: '9.9', user_id: userId };
    await db('slack_threads').insert([
      { ...thread, session_id: s1 },
      { ...thread, session_id: s2 },
    ]);
    expect(await db('slack_threads')).toHaveLength(2);
    await expect(db('slack_threads').insert({ ...thread, session_id: s1 })).rejects.toThrow(
      /UNIQUE/
    );
  });

  it('starts a thread with nothing posted and no loader message', async () => {
    const { userId, appId } = await seed();
    const [sessionId] = await insertSession(userId);
    await db('slack_threads').insert({
      slack_app_id: appId,
      channel_id: 'C1',
      thread_ts: '9.9',
      session_id: sessionId,
      user_id: userId,
    });
    expect(await db('slack_threads').first()).toMatchObject({
      last_posted_message_id: 0,
      status_ts: null,
    });
  });

  it('rolls back and re-applies cleanly', async () => {
    await db.migrate.down();
    expect(await tables()).not.toContain('slack_threads');
    expect(await tables()).not.toContain('slack_user_links');
    expect(await columns('slack_apps')).not.toContain('client_id');
    expect(await columns('slack_apps')).not.toContain('api_app_id');
    expect(await columns('sessions')).not.toContain('slack_owner');
    expect(await columns('sessions')).not.toContain('slack_approvals');

    await db.migrate.latest();
    expect(await tables()).toContain('slack_threads');
    expect(await columns('slack_apps')).toContain('api_app_id');
    expect(await columns('sessions')).toContain('slack_approvals');
  });
});
