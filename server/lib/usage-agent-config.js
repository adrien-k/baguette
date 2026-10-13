import { usageConfigIdFromSnapshot } from './usage-snapshot.js';

/**
 * @param {Record<string, unknown>} session Merged sessions API row or `agents` row (see `usage-snapshot.js`).
 * @param {'builder'|'reviewer'|string|null|undefined} [agentType]
 * @returns {number|null}
 */
export function usageAgentConfigIdForSession(session, agentType) {
  return usageConfigIdFromSnapshot(session, agentType);
}

/**
 * Config id stored on a usage row for a live turn. Prefer the snapshot taken when the
 * turn started (`agentConfigId`); fall back to the session row when omitted.
 *
 * @param {Record<string, unknown>} session
 * @param {{ agentType?: string|null, agentConfigId?: number|null }} [options]
 */
export function usageAgentConfigIdForTurn(session, { agentType, agentConfigId } = {}) {
  if (agentConfigId != null && agentConfigId !== '') {
    const n = Number(agentConfigId);
    if (Number.isFinite(n)) return n;
  }
  return usageAgentConfigIdForSession(session, agentType);
}

/**
 * Agent config id a turn must run with: builder config for chat, review config
 * (falling back to builder) for review. Throws when the session has none — turns
 * never fall back to account-level credentials.
 *
 * @param {Record<string, unknown>} session
 * @param {'builder'|'reviewer'|string|null|undefined} [agentType]
 */
export function requireAgentConfigIdForSession(session, agentType) {
  const configId = usageAgentConfigIdForSession(session, agentType);
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
 * @param {'builder'|'reviewer'|string|null|undefined} [agentType]
 */
export function requireAgentConfigIdForTurn(session, row, channelOrAgentType) {
  const raw = row?.agent_config_id;
  if (raw != null && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  let agentType = row?.agent_type;
  if (!agentType) {
    if (channelOrAgentType === 'review' || channelOrAgentType === 'reviewer') {
      agentType = 'reviewer';
    } else if (channelOrAgentType === 'chat' || channelOrAgentType === 'builder') {
      agentType = 'builder';
    } else {
      agentType = channelOrAgentType ?? 'builder';
    }
  }
  return requireAgentConfigIdForSession(session, agentType);
}

/** Review start/send payload may name the config explicitly. */
export function reviewTurnAgentConfigId(session, data = {}) {
  const raw = data.review_agent_config_id;
  if (raw != null && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return usageAgentConfigIdForSession(session, 'reviewer');
}
