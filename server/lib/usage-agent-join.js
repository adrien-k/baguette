/** Usage rows with persisted pricing snapshots (no `agents` join required). */

const USAGE_ROW_COLUMNS = [
  'u.id',
  'u.session_id',
  'u.agent_type',
  'u.model',
  'u.model_params',
  'u.agent_sdk',
  'u.raw_token_usage',
  'u.input_tokens',
  'u.output_tokens',
  'u.cache_read_tokens',
  'u.cache_write_tokens',
  'u.reasoning_tokens',
  'u.total_tokens',
];

/**
 * @param {import('knex').Knex} db
 * @returns {import('knex').Knex.QueryBuilder}
 */
export function usageQueryWithAgentPricing(db) {
  return db('usage as u').select(...USAGE_ROW_COLUMNS);
}
