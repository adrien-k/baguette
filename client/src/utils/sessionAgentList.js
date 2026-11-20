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
 * The head row is the session `pinned_agent_id` when set and valid; otherwise
 * the primary builder. Everyone else follows in last-activity order (primary
 * included when a different agent is pinned). Ref-ascending order breaks ties.
 *
 * @param {Array<object>} agents
 * @param {number | null | undefined} [pinnedAgentId]
 * @returns {Array<object>} Head agent, then others by last activity desc.
 */
export function buildSessionAgentList(agents, pinnedAgentId) {
  const sorted = sortSessionAgentsByRefAsc(agents ?? []);
  const primary = sorted.find(isPrimaryAgent) ?? null;
  const pinnedId = pinnedAgentId != null && pinnedAgentId !== '' ? Number(pinnedAgentId) : null;
  const pinned =
    pinnedId != null && Number.isFinite(pinnedId)
      ? (sorted.find((a) => a.id === pinnedId) ?? null)
      : null;

  const head = pinned ?? primary;
  if (!head) return sortSessionAgentsByLastActivityDesc(sorted);

  const remaining = sorted.filter((a) => a.id !== head.id);
  return [head, ...sortSessionAgentsByLastActivityDesc(remaining)];
}
