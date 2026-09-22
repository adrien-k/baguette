/**
 * Drops the per-user Personal Access Token column. GitHub access is now always the
 * GitHub App user-to-server token stored in access_token_encrypted.
 *
 * SQLite: Knex `dropColumn` rebuilds the table and runs DROP TABLE users, which fails
 * because sessions, usage, and user_repos reference users. Use native
 * ALTER TABLE ... DROP COLUMN (SQLite 3.35+) instead.
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'github_token_encrypted'))) return;
  await knex.raw('ALTER TABLE users DROP COLUMN github_token_encrypted');
}

export async function down(knex) {
  if (await knex.schema.hasColumn('users', 'github_token_encrypted')) return;
  await knex.raw('ALTER TABLE users ADD COLUMN github_token_encrypted TEXT');
}
