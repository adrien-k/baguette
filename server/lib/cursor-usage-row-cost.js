import {
  estimateAgentTurnCostUsd,
  parseModelParamsJson,
} from '../../shared/agent-model-pricing.js';

/**
 * USD estimate for a Cursor/Pi `usage` row (or live turn tokens) using session model snapshots.
 * Mirrors `sessions.recordCursorUsage` / `recordPiUsage` so recomputes match new turns.
 *
 * `input_tokens` on the row is already derived from `raw_token_usage` for Cursor; see
 * `shared/cursor-token-adjustment.js`.
 *
 * @param {Record<string, unknown>} turnUsage token fields + optional `model`
 * @param {Record<string, unknown>} session sessions row (model / review_model / *_params)
 * @param {{ kind?: string|null, turnModel?: { model?: string|null, modelParams?: unknown } }} [options]
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

  const priced = estimateAgentTurnCostUsd(turnUsage, modelId, parseModelParamsJson(paramsJson));
  return priced ?? 0;
}
