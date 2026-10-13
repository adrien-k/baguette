import { applyCursorUsageDerivation } from '../../shared/cursor-token-adjustment.js';
import { turnUsageFromUsageRow } from './cursor-usage-row-cost.js';
import { estimateTurnCostUsd, estimateTurnCostUsdSync } from './usage-model-pricing.js';
import { usageModelFieldsFromSnapshot } from './usage-snapshot.js';

function sessionModelFields(session, agentType) {
  return usageModelFieldsFromSnapshot(session, agentType);
}

function resolveModelAndParams(turnUsage, session, { agentType, turnModel } = {}) {
  const { model: sessionModel, paramsJson } = sessionModelFields(session, agentType);
  const modelId = turnUsage?.model ?? turnModel?.model ?? sessionModel ?? null;
  const paramsJsonResolved =
    turnModel?.model != null && turnModel.model !== '' ? turnModel.modelParams : paramsJson;
  return { modelId, paramsJson: paramsJsonResolved };
}

/**
 * USD for a live turn or persisted usage row using DB overrides + built-in pricing.
 *
 * @param {import('knex').Knex} db
 * @param {Record<string, unknown>} turnUsage
 * @param {Record<string, unknown>} session
 * @param {{ agentType?: string|null, turnModel?: { model?: string|null, modelParams?: unknown } }} [options]
 */
export async function estimateUsageRowCostUsd(db, turnUsage, session, options = {}) {
  if (!turnUsage || !session) return 0;
  const usage = { ...turnUsage };
  if (usage.raw_token_usage != null) {
    applyCursorUsageDerivation(usage);
  }
  const { modelId, paramsJson } = resolveModelAndParams(usage, session, options);
  return estimateTurnCostUsd(db, usage, modelId, paramsJson);
}

function persistedUsagePricingSnapshot(usageRow) {
  return {
    agent_type: usageRow.agent_type,
    model: usageRow.agent_model,
    model_params: usageRow.agent_model_params,
  };
}

/**
 * Like `estimatePersistedUsageRowCostUsd` but uses warmed pricing cache (no per-row DB).
 *
 * @param {Record<string, unknown>} usageRow Usage row plus `agent_*` from `usageQueryWithAgentPricing`
 */
export function estimatePersistedUsageRowCostUsdSync(usageRow) {
  const session = persistedUsagePricingSnapshot(usageRow);
  const turnUsage = turnUsageFromUsageRow(usageRow);
  if (!turnUsage || !session) return 0;
  const usage = { ...turnUsage };
  if (usage.raw_token_usage != null) {
    applyCursorUsageDerivation(usage);
  }
  const { modelId, paramsJson } = resolveModelAndParams(usage, session, {
    agentType: usageRow.agent_type,
    turnModel: { model: usageRow.model },
  });
  return estimateTurnCostUsdSync(usage, modelId, paramsJson);
}
