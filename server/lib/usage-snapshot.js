/**
 * Fields for usage pricing / config resolution. Not raw `sessions` table columns —
 * use a merged sessions API row (`mergeSessionAgentFields`) or an `agents` table row.
 */

import { normalizeUsageAgentType } from '../../shared/usage-agent-type.js';

function coerceAgentConfigId(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isAgentTableRow(snapshot) {
  const t = snapshot?.agent_type;
  return t === 'builder' || t === 'reviewer';
}

/**
 * @param {Record<string, unknown> | null | undefined} snapshot
 * @param {'builder'|'reviewer'|string|null|undefined} [agentType]
 */
export function usageConfigIdFromSnapshot(snapshot, agentType) {
  if (!snapshot) return null;
  const type = normalizeUsageAgentType(agentType ?? snapshot.agent_type ?? 'builder');
  if (isAgentTableRow(snapshot)) {
    if (normalizeUsageAgentType(snapshot.agent_type) !== type) return null;
    return coerceAgentConfigId(snapshot.agent_config_id);
  }
  const isReview = type === 'reviewer';
  const raw = isReview
    ? (snapshot.review_agent_config_id ?? snapshot.agent_config_id)
    : snapshot.agent_config_id;
  return coerceAgentConfigId(raw);
}

/**
 * @param {Record<string, unknown> | null | undefined} snapshot
 * @param {'builder'|'reviewer'|string|null|undefined} [agentType]
 * @returns {{ model: string|null|undefined, paramsJson: unknown }}
 */
export function usageModelFieldsFromSnapshot(snapshot, agentType) {
  if (!snapshot) return { model: null, paramsJson: null };
  const type = normalizeUsageAgentType(agentType ?? snapshot.agent_type ?? 'builder');
  if (isAgentTableRow(snapshot)) {
    if (normalizeUsageAgentType(snapshot.agent_type) === type) {
      return {
        model: snapshot.model ?? null,
        paramsJson: snapshot.model_params ?? null,
      };
    }
  }
  const isReview = type === 'reviewer';
  return {
    model: isReview ? snapshot.review_model : snapshot.model,
    paramsJson: isReview
      ? (snapshot.review_model_params ?? snapshot.model_params)
      : snapshot.model_params,
  };
}
