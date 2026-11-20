import {
  isPrimaryAgent,
  sortSessionAgentsByLastActivityDesc,
  sortSessionAgentsByRefAsc,
} from './sessionAgents.js';

/**
 * Flat agent list for a session's embedded agent summaries — primary builder,
 * reviewer, extra builders, and subagents all sit at the same level (no
 * nesting; `parent_agent_id` is ignored for display ordering).
 *
 * The primary builder is pinned first at all times; every other agent is
 * ordered by last activity, most recent first (`updated_at` — bumped on every
 * agent patch, e.g. turn start/end). Ref-ascending order (creation order)
 * breaks ties and covers agents without a timestamp.
 *
 * @param {Array<object>} agents
 * @returns {Array<object>} Primary builder, then other agents by last activity desc.
 */
export function buildSessionAgentList(agents) {
  const sorted = sortSessionAgentsByRefAsc(agents ?? []);
  const primaryIdx = sorted.findIndex(isPrimaryAgent);
  if (primaryIdx === -1) return sortSessionAgentsByLastActivityDesc(sorted);
  const [primary] = sorted.splice(primaryIdx, 1);
  return [primary, ...sortSessionAgentsByLastActivityDesc(sorted)];
}
