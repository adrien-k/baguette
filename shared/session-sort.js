/**
 * Dashboard / sidebar session list order: active sessions first, archived last,
 * then most recent activity within each group. PR status does not affect order.
 */

export function sessionLastActivityMs(session) {
  const t = session?.last_activity_at ?? session?.updated_at ?? session?.created_at;
  return t ? new Date(t).getTime() : 0;
}

export function compareSessionsForList(a, b) {
  const aArchived = a?.archived_at ? 1 : 0;
  const bArchived = b?.archived_at ? 1 : 0;
  if (aArchived !== bArchived) return aArchived - bArchived;
  return sessionLastActivityMs(b) - sessionLastActivityMs(a);
}

export function sortSessionsForList(sessions) {
  return [...sessions].sort(compareSessionsForList);
}
