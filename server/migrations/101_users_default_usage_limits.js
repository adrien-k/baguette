/**
 * Account-level defaults for new sessions and loops (Settings → Agent).
 * Native ALTER TABLE ADD COLUMN — no users table rebuild (see AGENTS.md).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'default_usage_limit_action'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN default_usage_limit_action TEXT');
  }
  if (!(await knex.schema.hasColumn('users', 'default_usage_limit'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN default_usage_limit REAL');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('users', 'default_usage_limit')) {
    await knex.raw('ALTER TABLE users DROP COLUMN default_usage_limit');
  }
  if (await knex.schema.hasColumn('users', 'default_usage_limit_action')) {
    await knex.raw('ALTER TABLE users DROP COLUMN default_usage_limit_action');
  }
}
