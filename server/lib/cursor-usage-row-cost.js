import {
  estimateAgentTurnCostUsd,
  parseModelParamsJson,
} from '../../shared/agent-model-pricing.js';
import { parseCursorRawTokenUsage } from '../../shared/cursor-token-adjustment.js';
import { usageModelFieldsFromSnapshot } from './usage-snapshot.js';

/**
 * USD estimate for a Cursor/Pi `usage` row (or live turn tokens) using model snapshots.
 * Mirrors `sessions.recordCursorUsage` / `recordPiUsage` so recomputes match new turns.
 *
 * `input_tokens` on the row is already derived from `raw_token_usage` for Cursor; see
 * `shared/cursor-token-adjustment.js`.
 *
 * @param {Record<string, unknown>} turnUsage token fields + optional `model`
 * @param {Record<string, unknown>} session Merged sessions API row or `agents` row (see `usage-snapshot.js`)
 * @param {{ agentType?: string|null, turnModel?: { model?: string|null, modelParams?: unknown } }} [options]
 * @returns {number}
 */
export function estimateCursorUsageCostUsd(turnUsage, session, { agentType, turnModel } = {}) {
  const { model: sessionModel, paramsJson: sessionParamsJson } = usageModelFieldsFromSnapshot(
    session,
    agentType
  );

  const modelId = turnUsage?.model ?? turnModel?.model ?? sessionModel ?? null;

  const paramsJson =
    turnModel?.model != null && turnModel.model !== '' ? turnModel.modelParams : sessionParamsJson;

  const priced = estimateAgentTurnCostUsd(turnUsage, modelId, parseModelParamsJson(paramsJson));
  return priced ?? 0;
}

/** @param {Record<string, unknown>} usageRow */
export function turnUsageFromUsageRow(usageRow) {
  const raw = parseCursorRawTokenUsage(usageRow.raw_token_usage);
  const tokenSource = raw ?? usageRow;
  return {
    input_tokens: Number(usageRow.input_tokens) || 0,
    output_tokens: Number(tokenSource.output_tokens) || 0,
    cache_read_tokens: Number(tokenSource.cache_read_tokens) || 0,
    cache_write_tokens: Number(tokenSource.cache_write_tokens) || 0,
    reasoning_tokens: Number(tokenSource.reasoning_tokens) || 0,
    total_tokens: Number(usageRow.total_tokens) || 0,
    model: usageRow.model ?? null,
    raw_token_usage: usageRow.raw_token_usage ?? null,
  };
}
