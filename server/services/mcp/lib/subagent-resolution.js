import { getAgentById, getAgentBySessionRef, SESSION_AGENT_TYPES } from '../../agents-db.js';
import { agentFailureError } from '../../agent-error-message.js';

const SESSION_AGENT_TYPE_SET = new Set(SESSION_AGENT_TYPES);

/**
 * Summarize a subagent row; `notifyParent` is the observed-agent presence in
 * `agent_observers` (notify_parent became a subscription row, not a column).
 */
export function formatSubagentSummary(agent, { notifyParent = false } = {}) {
  if (!agent) return null;
  return {
    agent_id: agent.id,
    ref: agent.ref,
    name: agent.name,
    status: agent.status,
    error_message: agentFailureError(agent),
    parent_agent_id: agent.parent_agent_id ?? null,
    notify_parent: Boolean(notifyParent),
  };
}

/**
 * @param {import('knex').Knex} db
 * @param {number} sessionId
 * @param {{ agent_id?: number, agent_ref?: number }} ids
 */
export async function resolveAgentInSession(db, sessionId, { agent_id, agent_ref }) {
  if (agent_id != null) {
    const id = Number(agent_id);
    if (!Number.isFinite(id)) return null;
    const agent = await getAgentById(db, id);
    if (!agent || agent.session_id !== sessionId) return null;
    if (!SESSION_AGENT_TYPE_SET.has(agent.agent_type)) return null;
    return agent;
  }
  if (agent_ref != null) {
    const ref = Number(agent_ref);
    if (!Number.isFinite(ref)) return null;
    const agent = await getAgentBySessionRef(db, sessionId, ref);
    if (!agent || !SESSION_AGENT_TYPE_SET.has(agent.agent_type)) return null;
    return agent;
  }
  return null;
}

/** @deprecated Use resolveAgentInSession — subagent-only guard for StopSubagent. */
export async function resolveSubagentInSession(db, sessionId, ids) {
  const agent = await resolveAgentInSession(db, sessionId, ids);
  if (!agent || agent.agent_type !== 'subagent') return null;
  return agent;
}
