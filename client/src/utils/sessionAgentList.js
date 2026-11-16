import { sortSessionAgentsByRefAsc } from './sessionAgents.js';

/**
 * Flat agent list for a session's embedded agent summaries — primary builder,
 * reviewer, extra builders, and subagents all sit at the same level (no
 * nesting; `parent_agent_id` is ignored for display ordering).
 *
 * @param {Array<object>} agents
 * @returns {Array<object>} Agents ref-ascending (creation order).
 */
export function buildSessionAgentList(agents) {
  return sortSessionAgentsByRefAsc(agents ?? []);
}
