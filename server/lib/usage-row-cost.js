import { applyCursorUsageDerivation } from '../../shared/cursor-token-adjustment.js';
import { turnUsageFromUsageRow } from './cursor-usage-row-cost.js';
import { estimateTurnCostUsd, estimateTurnCostUsdSync } from './usage-model-pricing.js';

function sessionModelFields(session, kind) {
  const isReview = kind === 'review';
  return {
    model: isReview ? session.review_model : session.model,
    paramsJson: isReview
      ? (session.review_model_params ?? session.model_params)
      : session.model_params,
  };
}

function resolveModelAndParams(turnUsage, session, { kind, turnModel } = {}) {
  const { model: sessionModel, paramsJson } = sessionModelFields(session, kind);
  const modelId = turnUsage?.model ?? turnModel?.model ?? sessionModel ?? session.model ?? null;
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
 * @param {{ kind?: string|null, turnModel?: { model?: string|null, modelParams?: unknown } }} [options]
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

/**
 * Like `estimatePersistedUsageRowCostUsd` but uses warmed pricing cache (no per-row DB).
 *
 * @param {Record<string, unknown>} usageRow joined session columns on the same object
 */
export function estimatePersistedUsageRowCostUsdSync(usageRow) {
  const session = {
    model: usageRow.session_model,
    model_params: usageRow.model_params,
    review_model: usageRow.review_model,
    review_model_params: usageRow.review_model_params,
  };
  const turnUsage = turnUsageFromUsageRow(usageRow);
  if (!turnUsage || !session) return 0;
  const usage = { ...turnUsage };
  if (usage.raw_token_usage != null) {
    applyCursorUsageDerivation(usage);
  }
  const { modelId, paramsJson } = resolveModelAndParams(usage, session, {
    kind: usageRow.kind,
    turnModel: { model: usageRow.model },
  });
  return estimateTurnCostUsdSync(usage, modelId, paramsJson);
}
