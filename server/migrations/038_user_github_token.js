/**
 * Optional per-user GitHub PAT (encrypted). Used instead of the GitHub App
 * user-to-server token when set.
 *
 * SQLite: use native DROP/ADD COLUMN — avoid Knex dropColumn table rebuild.
 */
export async function up(knex) {
  if (await knex.schema.hasColumn('users', 'github_token_encrypted')) return;
  await knex.raw('ALTER TABLE users ADD COLUMN github_token_encrypted TEXT');
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('users', 'github_token_encrypted'))) return;
  await knex.raw('ALTER TABLE users DROP COLUMN github_token_encrypted');
}
