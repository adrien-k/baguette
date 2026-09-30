/** Timestamp used for unread comparison when `last_activity_at` is unset. */
export function sessionActivityAt(session) {
  return session?.last_activity_at ?? session?.updated_at ?? session?.created_at ?? null;
}

/** True when `last_viewed_at` should be patched to match current activity. */
export function sessionNeedsLastViewedUpdate(session) {
  const activityAt = sessionActivityAt(session);
  if (!activityAt) return false;
  const viewedAt = session?.last_viewed_at;
  if (viewedAt && new Date(viewedAt).getTime() >= new Date(activityAt).getTime()) return false;
  return true;
}

/** True when the session has activity newer than the last time it was opened. */
export function sessionHasUnreadActivity(session) {
  if (!session || session.archived_at) return false;
  const activityAt = sessionActivityAt(session);
  if (!activityAt) return false;
  const viewedAt = session.last_viewed_at;
  if (!viewedAt) return true;
  return new Date(viewedAt).getTime() < new Date(activityAt).getTime();
}
