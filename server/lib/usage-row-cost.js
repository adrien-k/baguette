import { applyCursorUsageDerivation } from '../../shared/cursor-token-adjustment.js';
import { turnUsageFromUsageRow } from './cursor-usage-row-cost.js';
import { estimateTurnCostUsd, estimateTurnCostUsdSync } from './usage-model-pricing.js';
import { usageModelFieldsFromSnapshot } from './usage-snapshot.js';

function resolveModelAndParams(turnUsage, pricingSnapshot) {
  const { model: snapshotModel, paramsJson } = usageModelFieldsFromSnapshot(pricingSnapshot);
  const modelId = turnUsage?.model ?? snapshotModel ?? null;
  return { modelId, paramsJson };
}

/**
 * USD for a live turn or persisted usage row using DB overrides + built-in pricing.
 *
 * @param {import('knex').Knex} db
 * @param {Record<string, unknown>} turnUsage
 * @param {Record<string, unknown>|null|undefined} pricingSnapshot Row snapshot (`model`, `model_params`)
 */
export async function estimateUsageRowCostUsd(db, turnUsage, pricingSnapshot) {
  if (!turnUsage) return 0;
  const usage = { ...turnUsage };
  if (usage.raw_token_usage != null) {
    applyCursorUsageDerivation(usage);
  }
  const { modelId, paramsJson } = resolveModelAndParams(usage, pricingSnapshot);
  return estimateTurnCostUsd(db, usage, modelId, paramsJson);
}

function persistedUsagePricingSnapshot(usageRow) {
  return {
    agent_type: usageRow.agent_type,
    model: usageRow.model,
    model_params: usageRow.model_params,
  };
}

/**
 * Like `estimatePersistedUsageRowCostUsd` but uses warmed pricing cache (no per-row DB).
 *
 * @param {Record<string, unknown>} usageRow Usage row from `usageQueryWithAgentPricing`
 */
export function estimatePersistedUsageRowCostUsdSync(usageRow) {
  const snapshot = persistedUsagePricingSnapshot(usageRow);
  const turnUsage = turnUsageFromUsageRow(usageRow);
  if (!turnUsage) return 0;
  const usage = { ...turnUsage };
  if (usage.raw_token_usage != null) {
    applyCursorUsageDerivation(usage);
  }
  const { modelId, paramsJson } = resolveModelAndParams(usage, snapshot);
  return estimateTurnCostUsdSync(usage, modelId, paramsJson);
}
