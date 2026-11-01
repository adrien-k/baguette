import { diffModelUsage } from '../../services/turn-usage.js';
import { estimateUsageRowCostUsd } from '../../lib/usage-row-cost.js';
import { resolveUsageRecordContext, usageRowTokenFields } from '../../lib/usage-record-context.js';
import { CLAUDE_AGENT_SDK_KEY } from './meta.js';
import { getLastResultTotals, setLastResultTotals } from './usage-totals.js';

/**
 * Incremental Claude tokens for one finished turn's final SDK `result`, with
 * USD estimated from the shared agent pricing table (same as Cursor and Pi).
 *
 * `modelUsage` is a running total for the query, so this turn's share is the
 * difference from the last result for `totalsKey`. See
 * server/services/turn-usage.js.
 *
 * @returns {Promise<number>} cost written to `usage.cost_usd`
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
  const turnUsage = diffModelUsage(prev.models, result.modelUsage);
  setLastResultTotals(key, {
    models: result.modelUsage ?? {},
  });

  const db = app.get('db');
  const { agent, agent_type, snapshot, agent_config_id } = await resolveUsageRecordContext(
    db,
    session,
    { agentId, turnModel, turnUsage, agentConfigId }
  );
  const costUsd = await estimateUsageRowCostUsd(db, turnUsage, snapshot);

  if (costUsd <= 0 && (turnUsage.total_tokens ?? 0) <= 0) return 0;

  const row = {
    cost_usd: Math.max(costUsd, 0),
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
    costUsd,
  });
}
