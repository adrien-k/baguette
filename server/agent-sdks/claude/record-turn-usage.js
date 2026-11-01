import { delta, diffModelUsage } from '../../services/turn-usage.js';
import { resolveUsageRecordContext, usageRowTokenFields } from '../../lib/usage-record-context.js';
import { CLAUDE_AGENT_SDK_KEY } from './meta.js';
import { getLastResultTotals, setLastResultTotals } from './usage-totals.js';

/**
 * Incremental Claude cost/tokens for one finished turn's final SDK `result`.
 *
 * `total_cost_usd` and `modelUsage` are running totals for the query, so this
 * turn's share is the difference from the last result for `totalsKey`. See
 * server/services/turn-usage.js.
 *
 * @returns {Promise<number>} cost delta written to `usage.cost_usd`
 */
export async function recordClaudeTurnUsage(
  app,
  session,
  result,
  { turnModel, totalsKey, patchSessionCost, agentConfigId, agentId } = {}
) {
  if (!session || !result) return 0;
  const key = totalsKey ?? session.id;
  const prev = getLastResultTotals(key);
  const costUpdate = delta(prev.cost, result.total_cost_usd);
  const turnUsage = diffModelUsage(prev.models, result.modelUsage);
  setLastResultTotals(key, {
    cost: Number(result.total_cost_usd) || 0,
    models: result.modelUsage ?? {},
  });
  if (costUpdate <= 0 && turnUsage.total_tokens <= 0) return 0;

  const db = app.get('db');
  const { agent, agent_type, snapshot, agent_config_id } = await resolveUsageRecordContext(
    db,
    session,
    { agentId, turnModel, turnUsage, agentConfigId }
  );

  const row = {
    cost_usd: Math.max(costUpdate, 0),
    agent_sdk: agent?.agent_sdk ?? CLAUDE_AGENT_SDK_KEY,
    agent_type,
    ...usageRowTokenFields(turnUsage),
    model: snapshot.model,
    model_params: snapshot.model_params,
    agent_config_id,
  };
  if (agent?.id != null) row.agent_id = agent.id;

  return app.service('sessions').insertUsageRow(session, row, {
    patchSessionCost,
    costUsd: costUpdate,
  });
}
