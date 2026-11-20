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
 * When a non-primary builder is pinned, order is pinned, primary, then everyone
 * else by last activity. With no pin (or primary pinned), the head row is the
 * primary or pinned agent, then the rest by activity. Ref-ascending breaks ties.
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
      ? (sorted.find((a) => a.id === pinnedId && a.agent_type === 'builder') ?? null)
      : null;

  if (pinned && primary && pinned.id !== primary.id) {
    const rest = sorted.filter((a) => a.id !== pinned.id && a.id !== primary.id);
    return [pinned, primary, ...sortSessionAgentsByLastActivityDesc(rest)];
  }

  const head = pinned ?? primary;
  if (!head) return sortSessionAgentsByLastActivityDesc(sorted);

  const remaining = sorted.filter((a) => a.id !== head.id);
  return [head, ...sortSessionAgentsByLastActivityDesc(remaining)];
}
