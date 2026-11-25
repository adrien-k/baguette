/**
 * The session parent migration (104): sessions remember the session that started them.
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

const columns = async () =>
  (await db.raw('select name from pragma_table_info(?)', ['sessions'])).map((c) => c.name);

describe('104: session parent', () => {
  it('adds parent_session_id', async () => {
    expect(await columns()).toContain('parent_session_id');
  });

  it('rolls back and re-applies cleanly', async () => {
    await db.migrate.down();
    expect(await columns()).not.toContain('parent_session_id');
    await db.migrate.latest();
    expect(await columns()).toContain('parent_session_id');
  });
});
