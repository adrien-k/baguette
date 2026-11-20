/**
 * The inbound Slack migration (077): credentials and Slack account links.
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

async function seed() {
  const [userId] = await db('users').insert({ github_id: 1, username: 'u', status: 'approved' });
  const [appId] = await db('slack_apps').insert({ name: 'a', bot_token_encrypted: 'x' });
  return { userId, appId };
}

describe('077: inbound Slack', () => {
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

  it('allows one Slack user per app to be linked once', async () => {
    const { userId, appId } = await seed();
    const link = { slack_app_id: appId, slack_user_id: 'U1', user_id: userId };
    await db('slack_user_links').insert(link);
    await expect(db('slack_user_links').insert(link)).rejects.toThrow(/UNIQUE/);
  });
});
