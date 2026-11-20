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
 * The primary builder is first at all times. When `pinnedAgentId` is set on
 * the session, that agent (if present and not primary) is next; every other
 * agent is ordered by last activity, most recent first (`updated_at` — bumped
 * on every agent patch, e.g. turn start/end). Ref-ascending order (creation
 * order) breaks ties and covers agents without a timestamp.
 *
 * @param {Array<object>} agents
 * @param {number | null | undefined} [pinnedAgentId]
 * @returns {Array<object>} Primary builder, optional pinned agent, then others by last activity desc.
 */
export function buildSessionAgentList(agents, pinnedAgentId) {
  const sorted = sortSessionAgentsByRefAsc(agents ?? []);
  const primaryIdx = sorted.findIndex(isPrimaryAgent);
  const pinnedId = pinnedAgentId != null && pinnedAgentId !== '' ? Number(pinnedAgentId) : null;
  if (primaryIdx === -1) {
    const byActivity = sortSessionAgentsByLastActivityDesc(sorted);
    if (pinnedId == null || !Number.isFinite(pinnedId)) return byActivity;
    const pinIdx = byActivity.findIndex((a) => a.id === pinnedId);
    if (pinIdx <= 0) return byActivity;
    const [pinned] = byActivity.splice(pinIdx, 1);
    return [pinned, ...byActivity];
  }
  const [primary] = sorted.splice(primaryIdx, 1);
  const byActivity = sortSessionAgentsByLastActivityDesc(sorted);
  if (pinnedId == null || !Number.isFinite(pinnedId) || primary.id === pinnedId) {
    return [primary, ...byActivity];
  }
  const pinIdx = byActivity.findIndex((a) => a.id === pinnedId);
  if (pinIdx === -1) return [primary, ...byActivity];
  const [pinned] = byActivity.splice(pinIdx, 1);
  return [primary, pinned, ...byActivity];
}
