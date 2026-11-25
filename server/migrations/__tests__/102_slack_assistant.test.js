/**
 * The Slack global session migration (102): typed global session sessions, served threads and allow-list.
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

const insertSession = (userId, fields = {}) =>
  db('sessions').insert({
    user_id: userId,
    is_global: 1,
    repo_full_name: '',
    base_branch: 'main',
    initial_prompt: 'p',
    ...fields,
  });

async function seed() {
  const [userId] = await db('users').insert({ github_id: 1, username: 'u', status: 'approved' });
  const [appId] = await db('slack_apps').insert({ name: 'a', bot_token_encrypted: 'x' });
  return { userId, appId };
}

describe('102: Slack global session', () => {
  it('replaces the per-thread bindings and approval state', async () => {
    expect(await tables()).not.toContain('slack_threads');
    expect(await columns('sessions')).not.toContain('slack_owner');
    expect(await columns('sessions')).not.toContain('slack_approvals');
    expect(await columns('sessions')).toContain('slack_app_id');
    expect(await columns('slack_apps')).toContain('allowed_repo_ids');
  });

  it('does not limit ordinary sessions', async () => {
    const { userId } = await seed();
    await insertSession(userId);
    await expect(insertSession(userId)).resolves.toBeDefined();
  });

  it('records each served thread and allowed user once', async () => {
    const { userId, appId } = await seed();
    const [sessionId] = await insertSession(userId, { slack_app_id: appId });
    const thread = { session_id: sessionId, channel_id: 'C1', thread_ts: '9.9' };
    await db('slack_session_threads').insert(thread);
    await expect(db('slack_session_threads').insert(thread)).rejects.toThrow(/UNIQUE/);
    const allowed = { session_id: sessionId, slack_user_id: 'U2' };
    await db('slack_session_allowed_users').insert(allowed);
    await expect(db('slack_session_allowed_users').insert(allowed)).rejects.toThrow(/UNIQUE/);
  });

  it('rolls back and re-applies cleanly', async () => {
    await db.migrate.down({ name: '103_slack_global_session_per_thread.js' });
    await db.migrate.down({ name: '102_slack_assistant.js' });
    expect(await tables()).toContain('slack_threads');
    expect(await tables()).not.toContain('slack_session_threads');
    expect(await columns('sessions')).not.toContain('slack_app_id');
    expect(await columns('sessions')).toContain('slack_approvals');

    await db.migrate.latest();
    expect(await tables()).toContain('slack_session_allowed_users');
    expect(await columns('slack_apps')).toContain('allowed_repo_ids');
  });
});
