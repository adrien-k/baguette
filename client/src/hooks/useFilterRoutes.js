import { useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { ALL_REPOS, GLOBAL_SCOPE, useRepoContext } from '../context/RepoContext.jsx';
import {
  homeUrlForScope,
  isAllSessionsPath,
  isLoopsPath,
  loopEditUrlForScope,
  loopsHomeUrlForScope,
  sessionUrlForScope,
} from '@baguette/shared/session-scope.js';

/**
 * Routes for the current picker scope (All sessions, Global, or a repo).
 * `sessionUrl` takes a session id (or the 'new' route segment); `loopEditUrl` takes a loop id.
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
  const loopEditUrl = useCallback((loopId) => loopEditUrlForScope(loopId, scope), [scope]);

  return { showRepoDetails, homeUrl, loopsHomeUrl, isLoopsView, sessionUrl, loopEditUrl };
}
