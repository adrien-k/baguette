/**
 * Drop the unused `pinned_agent_id` column from `sessions` now that agent pinning is removed.
 * Native SQLite `ALTER TABLE … DROP COLUMN` avoids table rebuilds and FK churn.
 */
export async function up(knex) {
  if (await knex.schema.hasColumn('sessions', 'pinned_agent_id')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN pinned_agent_id');
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('sessions', 'pinned_agent_id'))) {
    await knex.raw('ALTER TABLE sessions ADD COLUMN pinned_agent_id INTEGER NULL');
  }
}
