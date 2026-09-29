import {
  buildCursorRawTokenUsage,
  deriveCursorUsageFromRaw,
} from '../../shared/cursor-token-adjustment.js';

/**
 * Cursor usage: store SDK stream in `raw_token_usage`, derive `input_tokens` /
 * `total_tokens` for dashboard parity (see `shared/cursor-token-adjustment.js`).
 *
 * Two passes over existing Cursor rows:
 *   1. Copy current scalar token columns into `raw_token_usage` JSON.
 *   2. Recompute `input_tokens` and `total_tokens` from that snapshot.
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE usage ADD COLUMN raw_token_usage TEXT');

  const cursorRows = await knex('usage')
    .where({ agent_sdk: 'cursor' })
    .select(
      'id',
      'input_tokens',
      'output_tokens',
      'cache_read_tokens',
      'cache_write_tokens',
      'reasoning_tokens',
      'total_tokens'
    );

  for (const row of cursorRows) {
    const raw = buildCursorRawTokenUsage(row);
    await knex('usage')
      .where({ id: row.id })
      .update({
        raw_token_usage: JSON.stringify(raw),
      });
  }

  for (const row of cursorRows) {
    const raw = buildCursorRawTokenUsage(row);
    const derived = deriveCursorUsageFromRaw(raw);
    await knex('usage').where({ id: row.id }).update({
      input_tokens: derived.input_tokens,
      total_tokens: derived.total_tokens,
    });
  }
}

export async function down(knex) {
  await knex.raw('ALTER TABLE usage DROP COLUMN raw_token_usage');
}
