import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import Knex from 'knex';
import { down as skillsDown } from '../086_skills.js';

const migrationsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = /^086_skills/;

/** Fresh in-memory DB migrated up to the file immediately before 086. */
async function dbBeforeTarget() {
  const db = Knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: { directory: migrationsPath },
  });
  for (;;) {
    const [, pending] = await db.migrate.list();
    const next = pending[0]?.file ?? '';
    if (!next || TARGET.test(next)) break;
    await db.migrate.up();
  }
  return db;
}

describe('086 skills', () => {
  let db;

  afterEach(async () => {
    await db?.destroy();
  });

  it('creates the per-user skills table and drops it on down', async () => {
    db = await dbBeforeTarget();
    expect(await db.schema.hasTable('skills')).toBe(false);

    await db.migrate.latest();
    expect(await db.schema.hasTable('skills')).toBe(true);

    const columns = await db.raw('PRAGMA table_info(skills)');
    expect(columns.map((col) => col.name)).toEqual(
      expect.arrayContaining([
        'user_id',
        'label',
        'description',
        'content',
        'created_at',
        'updated_at',
      ])
    );

    // Roll back the skills migration itself (087_user_status now follows it in
    // the chain, so a global migrate.down() would roll back that one instead).
    await skillsDown(db);
    expect(await db.schema.hasTable('skills')).toBe(false);
  });
});
