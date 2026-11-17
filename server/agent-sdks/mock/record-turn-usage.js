import { resolveUsageRecordContext, usageRowTokenFields } from '../../lib/usage-record-context.js';
import { MOCK_AGENT_SDK } from './meta.js';

/**
 * Fake per-turn token totals for the mock agent (dev/e2e): constant figures so
 * the Usage page and sidebar cost tooltip have something to show without any
 * pricing-table lookup. Module-internal — only `recordMockTurnUsage` reads it.
 */
const MOCK_TURN_USAGE = Object.freeze({
  input_tokens: 1_200,
  output_tokens: 340,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 1_540,
});

/** Fake USD cost charged for every completed mock turn. */
export const MOCK_TURN_COST_USD = 0.01;

/**
 * One completed mock turn: fixed fake tokens + fixed fake USD, recorded like
 * the real SDKs so `usage` rows, `sessions.total_cost_usd`, and the per-agent
 * sidebar cost all update.
 *
 * @returns {Promise<number>} cost written to `usage.cost_usd`
 */
export async function recordMockTurnUsage(
  app,
  session,
  { turnModel, patchSessionCost, agentConfigId, agentId } = {}
) {
  if (!session) return 0;

  const db = app.get('db');
  const turnUsage = { ...MOCK_TURN_USAGE, model: turnModel?.model ?? null };
  const { agent, agent_type, snapshot, agent_config_id } = await resolveUsageRecordContext(
    db,
    session,
    { agentId, turnModel, turnUsage, agentConfigId }
  );

  const row = {
    cost_usd: MOCK_TURN_COST_USD,
    agent_sdk: agent?.agent_sdk ?? MOCK_AGENT_SDK,
    agent_type,
    agent_config_id,
    ...usageRowTokenFields(turnUsage),
    model: snapshot.model,
    model_params: snapshot.model_params,
  };
  if (agent?.id != null) row.agent_id = agent.id;

  return app.service('sessions').insertUsageRow(session, row, {
    patchSessionCost,
    costUsd: MOCK_TURN_COST_USD,
  });
}
