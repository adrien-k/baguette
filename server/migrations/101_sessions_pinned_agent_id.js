/**
 * User-selected agent chat to open by default and sort near the top of the agent list.
 *
 * Plain ADD COLUMN — no table rebuild (SQLite 3.35+).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('sessions', 'pinned_agent_id'))) {
    await knex.raw('ALTER TABLE sessions ADD COLUMN pinned_agent_id INTEGER NULL');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('sessions', 'pinned_agent_id')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN pinned_agent_id');
  }
}
