import { getAgentById, getAgentBySessionRef } from '../../agents-db.js';

export function formatSubagentSummary(agent) {
  if (!agent) return null;
  return {
    agent_id: agent.id,
    ref: agent.ref,
    name: agent.name,
    status: agent.status,
    parent_agent_id: agent.parent_agent_id ?? null,
  };
}

/**
 * @param {import('knex').Knex} db
 * @param {number} sessionId
 * @param {{ agent_id?: number, agent_ref?: number }} ids
 */
export async function resolveSubagentInSession(db, sessionId, { agent_id, agent_ref }) {
  if (agent_id != null) {
    const id = Number(agent_id);
    if (!Number.isFinite(id)) return null;
    const agent = await getAgentById(db, id);
    if (!agent || agent.session_id !== sessionId || agent.agent_type !== 'subagent') {
      return null;
    }
    return agent;
  }
  if (agent_ref != null) {
    const ref = Number(agent_ref);
    if (!Number.isFinite(ref)) return null;
    const agent = await getAgentBySessionRef(db, sessionId, ref);
    if (!agent || agent.agent_type !== 'subagent') return null;
    return agent;
  }
  return null;
}
