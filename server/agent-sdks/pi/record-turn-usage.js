import { estimateUsageRowCostUsd } from '../../lib/usage-row-cost.js';
import { resolveUsageRecordContext, usageRowTokenFields } from '../../lib/usage-record-context.js';
import { PI_AGENT_SDK_KEY } from './meta.js';

/**
 * One Pi turn: token totals from `turn_end` events, USD from the shared agent
 * pricing table.
 *
 * @param {Record<string, unknown>} turnUsage
 * @returns {Promise<number>}
 */
export async function recordPiTurnUsage(
  app,
  session,
  turnUsage,
  { turnModel, patchSessionCost, agentConfigId, agentId } = {}
) {
  if (!session || !turnUsage) return 0;

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
    agent_sdk: agent?.agent_sdk ?? PI_AGENT_SDK_KEY,
    agent_type,
    agent_config_id,
    ...usageRowTokenFields(turnUsage),
    model: snapshot.model,
    model_params: snapshot.model_params,
  };
  if (agent?.id != null) row.agent_id = agent.id;

  return app.service('sessions').insertUsageRow(session, row, {
    patchSessionCost,
    costUsd,
  });
}
