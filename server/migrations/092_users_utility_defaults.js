/**
 * Account-level utility model (Settings → Agent): a cheap model for small jobs —
 * naming sessions, branches, and secondary builders — instead of the session's
 * builder model. Native ALTER TABLE ADD COLUMN (no users table rebuild — see AGENTS.md).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'utility_default_config_id'))) {
    await knex.raw(
      'ALTER TABLE users ADD COLUMN utility_default_config_id INTEGER REFERENCES agent_configs(id)'
    );
  }
  if (!(await knex.schema.hasColumn('users', 'utility_default_model'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN utility_default_model TEXT');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('users', 'utility_default_model')) {
    await knex.raw('ALTER TABLE users DROP COLUMN utility_default_model');
  }
  if (await knex.schema.hasColumn('users', 'utility_default_config_id')) {
    await knex.raw('ALTER TABLE users DROP COLUMN utility_default_config_id');
  }
}
