/**
 * sessions.parent_session_id: the session whose agent started this one with CreateSession, so a
 * Slack global session can archive everything it spawned. Null for sessions people start.
 *
 * Native DDL only — never rebuild `sessions` (see AGENTS.md).
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE sessions ADD COLUMN parent_session_id INTEGER');
  await knex.raw(
    `CREATE INDEX sessions_parent_idx ON sessions (parent_session_id)
     WHERE parent_session_id IS NOT NULL`
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX sessions_parent_idx');
  await knex.raw('ALTER TABLE sessions DROP COLUMN parent_session_id');
}
