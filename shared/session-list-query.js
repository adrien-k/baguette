import { isAllSessionsPath, isGlobalSession } from './session-scope.js';
import { isSessionShownInAllSessionsView } from './session-all-sessions.js';

/** Custom `sessions.find` keys (not table columns). Stripped before Knex applies the query. */
export const SESSION_LIST_QUERY_FLAGS = ['include_archived', 'include_loop_runs', 'all_sessions'];

export function queryFlagEnabled(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function queryFlagDisabled(value) {
  return value === false || value === 0 || value === '0' || value === 'false';
}

/**
 * Feathers query for the dashboard / session sidebar list.
 * Scope comes from the URL; archived and loop-run toggles from filter state.
 */
export function sessionsListQueryFromPath(pathname, { showArchived, showLoopRuns } = {}) {
  const query = {
    include_archived: !!showArchived,
    include_loop_runs: showLoopRuns !== false,
  };
  if (!pathname || isAllSessionsPath(pathname)) {
    query.all_sessions = true;
    return query;
  }
  if (pathname.startsWith('/global')) {
    query.is_global = true;
    return query;
  }
  const repoMatch = pathname.match(/^\/repos\/(\d+)/);
  if (repoMatch) {
    query.repo_id = Number(repoMatch[1]);
    return query;
  }
  query.all_sessions = true;
  return query;
}

/** Client-side match for socket create/patch against the active list query. */
export function sessionMatchesListQuery(session, query = {}, repos) {
  if (!session) return false;
  if (queryFlagDisabled(query.include_archived) && session.archived_at) return false;
  if (queryFlagDisabled(query.include_loop_runs) && session.loop_id) return false;
  if (queryFlagEnabled(query.all_sessions)) {
    return isSessionShownInAllSessionsView(session, repos);
  }
  if (query.is_global !== undefined && queryFlagEnabled(query.is_global)) {
    return isGlobalSession(session);
  }
  if (query.repo_id != null) {
    return String(session.repo_id) === String(query.repo_id);
  }
  return true;
}
