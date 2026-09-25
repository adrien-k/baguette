export async function up(knex) {
  await knex.raw('ALTER TABLE sessions ADD COLUMN review_claude_session_id TEXT');
  await knex.raw('ALTER TABLE sessions ADD COLUMN review_cursor_agent_id TEXT');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN review_claude_session_id');
  await knex.raw('ALTER TABLE sessions DROP COLUMN review_cursor_agent_id');
}
