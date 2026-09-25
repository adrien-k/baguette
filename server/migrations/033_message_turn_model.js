/**
 * Per-message / per-queued-row model snapshot. Composer sends attach these so the
 * turn uses that model without changing sessions.model. Implicit messages
 * (fix buttons, MCP) leave them null and use the session default.
 *
 * Plain ADD COLUMN: SQLite does this natively (no table rebuild).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('session_messages', 'model'))) {
    await knex.raw('ALTER TABLE session_messages ADD COLUMN model TEXT');
  }
  if (!(await knex.schema.hasColumn('session_messages', 'model_params'))) {
    await knex.raw('ALTER TABLE session_messages ADD COLUMN model_params TEXT');
  }
  if (!(await knex.schema.hasColumn('queued_messages', 'model'))) {
    await knex.raw('ALTER TABLE queued_messages ADD COLUMN model TEXT');
  }
  if (!(await knex.schema.hasColumn('queued_messages', 'model_params'))) {
    await knex.raw('ALTER TABLE queued_messages ADD COLUMN model_params TEXT');
  }
}

export async function down(knex) {
  await knex.raw('ALTER TABLE session_messages DROP COLUMN model');
  await knex.raw('ALTER TABLE session_messages DROP COLUMN model_params');
  await knex.raw('ALTER TABLE queued_messages DROP COLUMN model');
  await knex.raw('ALTER TABLE queued_messages DROP COLUMN model_params');
}
