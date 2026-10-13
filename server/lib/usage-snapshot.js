/**
 * Fields for usage pricing / config resolution from a turn snapshot
 * (`agent_config_id`, `model`, `model_params`).
 */

export function coerceAgentConfigId(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} agentConfigId
 * @returns {number}
 */
export function requireAgentConfigId(agentConfigId) {
  const n = coerceAgentConfigId(agentConfigId);
  if (n == null) {
    throw new Error('Agent configuration is required to run this turn');
  }
  return n;
}

/**
 * @param {Record<string, unknown> | null | undefined} snapshot
 * @returns {{ model: string|null|undefined, paramsJson: unknown }}
 */
export function usageModelFieldsFromSnapshot(snapshot) {
  if (!snapshot) return { model: null, paramsJson: null };
  return {
    model: snapshot.model ?? null,
    paramsJson: snapshot.model_params ?? null,
  };
}
