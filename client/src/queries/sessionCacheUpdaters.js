import { applySessionRealtimeList } from '../utils/sessionRealtime.js';
import { sortSessionsForList } from '@baguette/shared/session-sort.js';
import { sessionMatchesListQuery } from '@baguette/shared/session-list-query.js';
import { applyAgentPatchToSession } from '../utils/sessionAgents.js';
import { sameScopeId } from '../utils/boundScope.js';
import { getRealtimeScope } from './realtimeScope.js';

/** Detail views keep previously fetched counts when a patch omits them. */
export function mergeSessionDetail(prev, updated) {
  if (!prev) return updated;
  return {
    ...prev,
    ...updated,
    open_issues_count: updated.open_issues_count ?? prev.open_issues_count,
    running_tasks_count: updated.running_tasks_count ?? prev.running_tasks_count,
  };
}

/** Does this realtime row belong in a list filtered by `listQuery`, per the published scope? */
export function sessionMatchesList(listQuery, session, scope = getRealtimeScope()) {
  return sessionMatchesListQuery(session, listQuery, scope.repos, {
    currentUserId: scope.currentUserId,
  });
}

/** Merge a realtime row into one finite page array (a list cache entry's rows). */
function mergeIntoRows(rows, session, matches) {
  const { next, skipDelta } = applySessionRealtimeList(rows, session, matches);
  return { next, skipDelta };
}

/**
 * Update one sessions-list cache entry (infinite-query data: `{pages, pageParams}`)
 * with a realtime session event. Returns the same reference when nothing changed.
 *
 * Next-page offsets are derived from the flattened row count at fetch time, so
 * insert/remove shifts need no per-page skip bookkeeping here.
 */
export function applySessionEventToInfiniteList(data, session, matches) {
  if (!data?.pages || !session?.id) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    const rows = page?.data ?? [];
    const { next, skipDelta } = mergeIntoRows(rows, session, matches);
    if (skipDelta !== 0 || next !== rows) changed = true;
    return next === rows ? page : { ...page, data: next };
  });
  if (!changed) return data;
  return { ...data, pages };
}

/** Merge a session patch into a detail cache entry; no-op for other sessions. */
export function applySessionEventToDetail(prev, session) {
  if (!prev || !sameScopeId(prev.id, session?.id)) return prev;
  return mergeSessionDetail(prev, session);
}

/** Merge an agent patch into a detail cache entry; no-op for other sessions. */
export function applyAgentEventToDetail(prev, agent) {
  if (!prev || !agent?.session_id) return prev;
  if (!sameScopeId(prev.id, agent.session_id)) return prev;
  return applyAgentPatchToSession(prev, agent);
}

/** Merge an agent patch into a list cache entry (rows array); returns same ref if unchanged. */
function applyAgentEventToRows(rows, agent) {
  if (!Array.isArray(rows) || !agent?.session_id) return rows;
  let changed = false;
  const next = rows.map((row) => {
    if (!sameScopeId(row?.id, agent.session_id)) return row;
    const merged = applyAgentPatchToSession(row, agent);
    if (merged === row) return row;
    changed = true;
    return merged;
  });
  if (!changed) return rows;
  return sortSessionsForList(next);
}

/** Merge an agent patch into an infinite list cache entry. */
export function applyAgentEventToInfiniteList(data, agent) {
  if (!data?.pages) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    const next = applyAgentEventToRows(page?.data ?? [], agent);
    if (next === (page?.data ?? [])) return page;
    changed = true;
    return { ...page, data: next };
  });
  if (!changed) return data;
  return { ...data, pages };
}

/** Drop a removed agent from a detail cache entry; no-op for other sessions. */
export function applyAgentRemoveToDetail(prev, agent) {
  if (!prev || !agent?.session_id || !sameScopeId(prev.id, agent.session_id)) return prev;
  if (!Array.isArray(prev.agents)) return prev;
  const agents = prev.agents.filter((a) => a.id !== agent.id);
  if (agents.length === prev.agents.length) return prev;
  return { ...prev, agents };
}

/** Drop a removed agent from list rows; returns same ref when not present. */
function applyAgentRemoveToRows(rows, agent) {
  if (!Array.isArray(rows) || !agent?.session_id) return rows;
  let changed = false;
  const next = rows.map((row) => {
    if (!sameScopeId(row?.id, agent.session_id)) return row;
    const merged = applyAgentRemoveToDetail(row, agent);
    if (merged === row) return row;
    changed = true;
    return merged;
  });
  if (!changed) return rows;
  return sortSessionsForList(next);
}

/** Drop a removed agent from an infinite list cache entry. */
export function applyAgentRemoveToInfiniteList(data, agent) {
  if (!data?.pages) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    const next = applyAgentRemoveToRows(page?.data ?? [], agent);
    if (next === (page?.data ?? [])) return page;
    changed = true;
    return { ...page, data: next };
  });
  if (!changed) return data;
  return { ...data, pages };
}

/** Remove a session from list rows; returns same ref when not present. */
function removeSessionFromRows(rows, sessionId) {
  if (!Array.isArray(rows)) return rows;
  const next = rows.filter((row) => !sameScopeId(row?.id, sessionId));
  return next.length === rows.length ? rows : next;
}

/** Remove a session from an infinite list cache entry. */
export function removeSessionFromInfiniteList(data, sessionId) {
  if (!data?.pages) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    const next = removeSessionFromRows(page?.data ?? [], sessionId);
    if (next === (page?.data ?? [])) return page;
    changed = true;
    return { ...page, data: next };
  });
  if (!changed) return data;
  return { ...data, pages };
}
