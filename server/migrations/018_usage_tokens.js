/**
 * Token counts and model per usage row.
 *
 * Cursor local agents cannot report billed USD via `agent.getUsage()` (403
 * `feature_unavailable`). Token counts from the run stream are stored here; Cursor
 * `cost_usd` is filled from the pricing table in application code when possible.
 *
 * Plain ADD COLUMNs: SQLite does these natively, so the table is not rebuilt and
 * the foreign keys into `usage` are untouched.
 */
const COLUMNS = [
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'reasoning_tokens',
  'total_tokens',
];

export async function up(knex) {
  for (const column of COLUMNS) {
    await knex.raw(`ALTER TABLE usage ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
  }
  await knex.raw('ALTER TABLE usage ADD COLUMN model VARCHAR(100)');
}

export async function down(knex) {
  for (const column of [...COLUMNS, 'model']) {
    await knex.raw(`ALTER TABLE usage DROP COLUMN ${column}`);
  }
}
