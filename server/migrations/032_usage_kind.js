/**
 * Distinguish session-chat usage from review-agent usage on the same session.
 * Cursor cost deltas sum prior rows; mixing the two agents would under/over-count.
 *
 * Plain ADD COLUMN: SQLite does this natively (no table rebuild).
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE usage ADD COLUMN kind TEXT');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE usage DROP COLUMN kind');
}
