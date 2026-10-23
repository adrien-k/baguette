import { useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { ALL_REPOS, GLOBAL_SCOPE, useRepoContext } from '../context/RepoContext.jsx';
import {
  homeUrlForScope,
  isAllSessionsPath,
  isLoopsPath,
  loopEditUrlForScope,
  loopsHomeUrlForScope,
  NEW_LOOP_ROUTE_ID,
  NEW_SESSION_ROUTE_ID,
  sessionUrlForScope,
} from '@baguette/shared/session-scope.js';

/**
 * Routes for the current picker scope (All sessions, Global, or a repo).
 * `sessionUrl` / `loopEditUrl` take a record id; `sessionNewUrl` / `loopNewUrl` open the create forms.
 */
export function useFilterRoutes() {
  const { pathname } = useLocation();
  const { selectedRepo, repos } = useRepoContext() ?? {};
  const fromAllSessions = isAllSessionsPath(pathname);
  const isLoopsView = isLoopsPath(pathname);

  const repoId = useMemo(() => {
    if (!selectedRepo || selectedRepo === ALL_REPOS || selectedRepo === GLOBAL_SCOPE) return null;
    return repos?.find((r) => r.full_name === selectedRepo)?.id ?? null;
  }, [selectedRepo, repos]);

  const scope = useMemo(
    () => ({ fromAllSessions, selectedRepo, repoId }),
    [fromAllSessions, selectedRepo, repoId]
  );

  const homeUrl = homeUrlForScope(scope);
  const loopsHomeUrl = loopsHomeUrlForScope(scope);
  const showRepoDetails = fromAllSessions || selectedRepo === ALL_REPOS;
  const sessionUrl = useCallback((sessionId) => sessionUrlForScope(sessionId, scope), [scope]);
  const sessionNewUrl = useCallback(() => sessionUrlForScope(NEW_SESSION_ROUTE_ID, scope), [scope]);
  const loopEditUrl = useCallback((loopId) => loopEditUrlForScope(loopId, scope), [scope]);
  const loopNewUrl = useCallback(() => loopEditUrlForScope(NEW_LOOP_ROUTE_ID, scope), [scope]);

  return {
    showRepoDetails,
    homeUrl,
    loopsHomeUrl,
    isLoopsView,
    sessionUrl,
    sessionNewUrl,
    loopEditUrl,
    loopNewUrl,
  };
}
