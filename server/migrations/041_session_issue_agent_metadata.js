/**
 * Snapshot reviewer agent_sdk / model / model_params when an issue is opened.
 * Plain ADD COLUMN — no table rebuild (SQLite 3.35+).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('session_issues', 'agent_sdk'))) {
    await knex.raw('ALTER TABLE session_issues ADD COLUMN agent_sdk TEXT');
  }
  if (!(await knex.schema.hasColumn('session_issues', 'model'))) {
    await knex.raw('ALTER TABLE session_issues ADD COLUMN model TEXT');
  }
  if (!(await knex.schema.hasColumn('session_issues', 'model_params'))) {
    await knex.raw('ALTER TABLE session_issues ADD COLUMN model_params TEXT');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('session_issues', 'model_params')) {
    await knex.raw('ALTER TABLE session_issues DROP COLUMN model_params');
  }
  if (await knex.schema.hasColumn('session_issues', 'model')) {
    await knex.raw('ALTER TABLE session_issues DROP COLUMN model');
  }
  if (await knex.schema.hasColumn('session_issues', 'agent_sdk')) {
    await knex.raw('ALTER TABLE session_issues DROP COLUMN agent_sdk');
  }
}
