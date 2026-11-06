/** Merge a realtime session event into the list before matching, so partial patches keep identity fields. */
export function mergeSessionRealtimeList(prev, session) {
  if (!session?.id) return { existing: null, merged: session };
  const existing = prev.find((row) => String(row.id) === String(session.id));
  const merged = existing ? { ...existing, ...session } : session;
  return { existing, merged };
}

/**
 * Apply a patched/created session to the current list.
 * `matches(merged)` is called on the merged row, not the raw event.
 */
export function applySessionRealtimeList(prev, session, matches) {
  if (!session?.id) return { next: prev, skipDelta: 0 };
  const { existing, merged } = mergeSessionRealtimeList(prev, session);
  if (!matches(merged)) {
    if (!existing) return { next: prev, skipDelta: 0 };
    return {
      next: prev.filter((row) => String(row.id) !== String(session.id)),
      skipDelta: -1,
    };
  }
  if (existing) {
    return {
      next: prev.map((row) => (String(row.id) === String(session.id) ? merged : row)),
      skipDelta: 0,
    };
  }
  return { next: [merged, ...prev], skipDelta: 1 };
}

/** Ignore partial patches that omit status so we do not wipe a seeded previous value. */
export function nextTrackedStatus(prevStatus, incomingStatus) {
  if (incomingStatus === undefined) return { next: prevStatus, changed: false };
  return {
    next: incomingStatus,
    changed: prevStatus !== undefined && prevStatus !== incomingStatus,
  };
}
