/**
 * One-time invite tokens for admin-created users (no GitHub App).
 * Native ALTER TABLE ADD COLUMN (no users table rebuild).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'invite_token_hash'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN invite_token_hash TEXT');
  }
  if (!(await knex.schema.hasColumn('users', 'invite_expires_at'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN invite_expires_at DATETIME');
  }
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_invite_token_hash_uidx
    ON users(invite_token_hash)
    WHERE invite_token_hash IS NOT NULL
  `);
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS users_invite_token_hash_uidx');
  if (await knex.schema.hasColumn('users', 'invite_expires_at')) {
    await knex.raw('ALTER TABLE users DROP COLUMN invite_expires_at');
  }
  if (await knex.schema.hasColumn('users', 'invite_token_hash')) {
    await knex.raw('ALTER TABLE users DROP COLUMN invite_token_hash');
  }
}
