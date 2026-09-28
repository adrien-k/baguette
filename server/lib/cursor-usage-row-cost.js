import {
  estimateCursorTurnCostUsd,
  parseModelParamsJson,
} from '../../shared/cursor-model-pricing.js';

/**
 * USD estimate for a Cursor `usage` row (or live turn tokens) using session model snapshots.
 * Mirrors cursor-agent `_turnCostUsd` so backfills match new turns.
 *
 * @param {Record<string, unknown>} turnUsage token fields + optional `model`
 * @param {Record<string, unknown>} session sessions row (model / review_model / *_params)
 * @param {{ kind?: string|null, turnModel?: { model?: string, modelParams?: string } }} [options]
 * @returns {number}
 */
export function estimateCursorUsageCostUsd(turnUsage, session, { kind, turnModel } = {}) {
  const sessionModel = kind === 'review' ? session.review_model : session.model;
  const sessionParamsJson =
    kind === 'review'
      ? (session.review_model_params ?? session.model_params)
      : session.model_params;

  const modelId = turnUsage?.model ?? turnModel?.model ?? sessionModel ?? session.model ?? null;

  const paramsJson =
    turnModel?.model != null && turnModel.model !== '' ? turnModel.modelParams : sessionParamsJson;

  const priced = estimateCursorTurnCostUsd(turnUsage, modelId, parseModelParamsJson(paramsJson));
  return priced ?? 0;
}

/** @param {Record<string, unknown>} usageRow */
export function turnUsageFromUsageRow(usageRow) {
  return {
    input_tokens: Number(usageRow.input_tokens) || 0,
    output_tokens: Number(usageRow.output_tokens) || 0,
    cache_read_tokens: Number(usageRow.cache_read_tokens) || 0,
    cache_write_tokens: Number(usageRow.cache_write_tokens) || 0,
    reasoning_tokens: Number(usageRow.reasoning_tokens) || 0,
    total_tokens: Number(usageRow.total_tokens) || 0,
    model: usageRow.model ?? null,
  };
}
