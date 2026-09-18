import { encrypt, decrypt } from '../lib/encrypt.js';

/**
 * SQLite: Knex `dropColumn` rebuilds the table and runs DROP TABLE users, which fails
 * because sessions, usage, and user_repos reference users. Use native
 * ALTER TABLE ... DROP COLUMN (SQLite 3.35+) instead.
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'access_token'))) {
    return;
  }

  if (!(await knex.schema.hasColumn('users', 'access_token_encrypted'))) {
    await knex.schema.table('users', (t) => {
      t.text('access_token_encrypted').nullable();
    });
  }

  const rows = await knex('users').select('id', 'access_token', 'access_token_encrypted');
  for (const row of rows) {
    if (row.access_token && !row.access_token_encrypted) {
      await knex('users')
        .where({ id: row.id })
        .update({ access_token_encrypted: encrypt(row.access_token) });
    }
  }

  await knex.raw('ALTER TABLE users DROP COLUMN access_token');
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('users', 'access_token_encrypted'))) {
    return;
  }

  if (!(await knex.schema.hasColumn('users', 'access_token'))) {
    await knex.raw("ALTER TABLE users ADD COLUMN access_token TEXT NOT NULL DEFAULT ''");
  }

  const rows = await knex('users').select('id', 'access_token_encrypted');
  for (const row of rows) {
    if (row.access_token_encrypted) {
      try {
        await knex('users')
          .where({ id: row.id })
          .update({ access_token: decrypt(row.access_token_encrypted) });
      } catch {
        // leave default ''
      }
    }
  }

  await knex.raw('ALTER TABLE users DROP COLUMN access_token_encrypted');
}
