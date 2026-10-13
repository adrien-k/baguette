/** Usage rows joined to the owning agent (migration 061 backfills `usage.agent_id`). */

const USAGE_ROW_COLUMNS = [
  'u.id',
  'u.session_id',
  'u.agent_type',
  'u.model',
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
  return db('usage as u')
    .innerJoin({ agent: 'agents' }, 'agent.id', 'u.agent_id')
    .select(
      ...USAGE_ROW_COLUMNS,
      'agent.model as agent_model',
      'agent.model_params as agent_model_params',
      'agent.agent_type as agent_type'
    );
}
