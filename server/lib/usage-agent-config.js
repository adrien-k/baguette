/**
 * @param {Record<string, unknown>} session
 * @param {string|null|undefined} kind
 * @returns {number|null}
 */
export function usageAgentConfigIdForSession(session, kind) {
  if (!session) return null;
  const raw =
    kind === 'review'
      ? (session.review_agent_config_id ?? session.agent_config_id)
      : session.agent_config_id;
  const n = raw == null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
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

/**
 * Agent config id a turn must run with: builder config for chat, review config
 * (falling back to builder) for review. Throws when the session has none — turns
 * never fall back to account-level credentials.
 *
 * @param {Record<string, unknown>} session
 * @param {string|null|undefined} kind
 */
export function requireAgentConfigIdForSession(session, kind) {
  const configId = usageAgentConfigIdForSession(session, kind);
  if (configId == null) {
    throw new Error('Agent configuration is required to run this turn');
  }
  return configId;
}

/**
 * Agent config id for one turn, from the message row's snapshot when present
 * (rows carry it since migration 060); legacy rows fall back to the session pair.
 * Throws when neither the row nor the session names a config.
 *
 * @param {Record<string, unknown>} session
 * @param {Record<string, unknown>|null|undefined} row - message / queued row
 * @param {string|null|undefined} kind
 */
export function requireAgentConfigIdForTurn(session, row, kind) {
  const raw = row?.agent_config_id;
  if (raw != null && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return requireAgentConfigIdForSession(session, kind);
}

/** Review start/send payload may name the config explicitly. */
export function reviewTurnAgentConfigId(session, data = {}) {
  const raw = data.review_agent_config_id;
  if (raw != null && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return usageAgentConfigIdForSession(session, 'review');
}
