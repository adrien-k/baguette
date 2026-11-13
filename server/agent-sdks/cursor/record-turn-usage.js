import { applyCursorUsageDerivation } from '../../../shared/cursor-token-adjustment.js';
import { estimateUsageRowCostUsd } from '../../lib/usage-row-cost.js';
import { resolveUsageRecordContext, usageRowTokenFields } from '../../lib/usage-record-context.js';
import { CURSOR_AGENT_SDK_KEY } from './meta.js';

/**
 * One Cursor turn: token totals from the run stream plus USD estimated from our
 * pricing table. Local Cursor agents cannot report billed USD via
 * `agent.getUsage()` (feature_unavailable).
 *
 * @param {Record<string, unknown>} turnUsage per-turn accumulator; derivation mutates it in place
 * @returns {Promise<number>} cost written to `usage.cost_usd`
 */
export async function recordCursorTurnUsage(
  app,
  session,
  turnUsage,
  { turnModel, patchSessionCost, agentConfigId, agentId } = {}
) {
  if (!session || !turnUsage) return 0;

  applyCursorUsageDerivation(turnUsage);
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
    agent_sdk: agent?.agent_sdk ?? CURSOR_AGENT_SDK_KEY,
    agent_type,
    agent_config_id,
    ...usageRowTokenFields(turnUsage),
    raw_token_usage: turnUsage.raw_token_usage,
    model: snapshot.model,
    model_params: snapshot.model_params,
  };
  if (agent?.id != null) row.agent_id = agent.id;

  return app.service('sessions').insertUsageRow(session, row, {
    patchSessionCost,
    costUsd,
  });
}
