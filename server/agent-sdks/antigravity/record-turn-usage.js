import { estimateUsageRowCostUsd } from '../../lib/usage-row-cost.js';
import { resolveUsageRecordContext, usageRowTokenFields } from '../../lib/usage-record-context.js';
import { ANTIGRAVITY_AGENT_SDK_KEY } from './meta.js';
import { stripAntigravityThoughtSuffix } from './model-params.js';

/**
 * One Antigravity turn: token totals from `PromptResponse.usage`, USD from the
 * shared agent pricing table.
 *
 * @param {object} app
 * @param {object} session
 * @param {Record<string, unknown>} turnUsage
 * @param {{ turnModel?: { model?: string | null, modelParams?: unknown } | string, patchSessionCost?: boolean, agentConfigId?: number | null, agentId?: number }} [opts]
 * @returns {Promise<number>}
 */
export async function recordAntigravityTurnUsage(
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

  let costUsd = await estimateUsageRowCostUsd(db, turnUsage, snapshot);
  if (costUsd <= 0 && snapshot.model) {
    const stripped = stripAntigravityThoughtSuffix(snapshot.model);
    if (stripped && stripped !== snapshot.model) {
      costUsd = await estimateUsageRowCostUsd(db, turnUsage, { ...snapshot, model: stripped });
    }
  }

  if (costUsd <= 0 && (Number(turnUsage.total_tokens) || 0) <= 0) return 0;

  const row = {
    cost_usd: Math.max(costUsd, 0),
    agent_sdk: agent?.agent_sdk ?? ANTIGRAVITY_AGENT_SDK_KEY,
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
