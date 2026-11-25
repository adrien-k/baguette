/**
 * The Slack global session per-thread migration (103): a user may own several global sessions in
 * one Slack app (one per thread).
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

const insertSession = (userId, fields = {}) =>
  db('sessions').insert({
    user_id: userId,
    is_global: 1,
    repo_full_name: '',
    base_branch: 'main',
    initial_prompt: 'p',
    ...fields,
  });

describe('103: Slack global session per thread', () => {
  it('lets one user own several live global sessions in one Slack app', async () => {
    const [userId] = await db('users').insert({ github_id: 1, username: 'u', status: 'approved' });
    const [appId] = await db('slack_apps').insert({ name: 'a', bot_token_encrypted: 'x' });
    await insertSession(userId, { slack_app_id: appId });
    await expect(insertSession(userId, { slack_app_id: appId })).resolves.toBeDefined();
  });

  it('can be rolled back and re-applied', async () => {
    await db.migrate.down();
    await db.migrate.latest();
  });
});
