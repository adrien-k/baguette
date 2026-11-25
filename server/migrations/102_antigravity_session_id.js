/**
 * Add antigravity_session_id column to agents for Antigravity ACP session resume.
 *
 * Plain ADD COLUMN — no table rebuild (SQLite 3.35+).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('agents', 'antigravity_session_id'))) {
    await knex.raw('ALTER TABLE agents ADD COLUMN antigravity_session_id TEXT');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('agents', 'antigravity_session_id')) {
    await knex.raw('ALTER TABLE agents DROP COLUMN antigravity_session_id');
  }
}
