/**
 * @param {Record<string, unknown>} session
 * @param {string|null|undefined} kind
 */
export function usageAgentConfigIdForSession(session, kind) {
  if (!session) return null;
  if (kind === 'review') {
    return session.review_agent_config_id ?? session.agent_config_id ?? null;
  }
  return session.agent_config_id ?? null;
}

/**
 * Config id stored on a usage row for a live turn. Prefer the snapshot taken when the
 * turn started (`agentConfigId`); fall back to the session row when omitted.
 *
 * @param {Record<string, unknown>} session
 * @param {{ kind?: string|null, agentConfigId?: number|null }} [options]
 */
export function usageAgentConfigIdForTurn(session, { kind, agentConfigId } = {}) {
  if (agentConfigId != null && agentConfigId !== '') {
    const n = Number(agentConfigId);
    if (Number.isFinite(n)) return n;
  }
  return usageAgentConfigIdForSession(session, kind);
}

/** Review start/send payload may name the config explicitly. */
export function reviewTurnAgentConfigId(session, data = {}) {
  const raw = data.review_agent_config_id ?? data.agent_config_id;
  if (raw != null && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return usageAgentConfigIdForSession(session, 'review');
}
