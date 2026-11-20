import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sessionKeys } from './keys.js';

/**
 * Module-level scope for the SSE cache bridge: the repos list and current user
 * id, published from React context (RepoContext/CurrentUserContext) so the
 * bridge — which lives outside React — can evaluate list filters
 * (`sessionMatchesListQuery`) for every cached sessions list.
 */
let realtimeScope = { repos: [], currentUserId: null };

export function setRealtimeScope(next) {
  realtimeScope = next;
}

export function getRealtimeScope() {
  return realtimeScope;
}

/**
 * Publish scope values to the bridge whenever they change. Scope changes also
 * refetch sessions lists: merge-time matching uses the new scope afterwards,
 * and a refetch guarantees already-cached rows are re-filtered authoritatively
 * (e.g. a repo becoming visible/invisible in "all sessions").
 */
export function usePublishRealtimeScope(repos, currentUserId) {
  const queryClient = useQueryClient();
  const firstRun = useRef(true);
  useEffect(() => {
    setRealtimeScope({ repos, currentUserId: currentUserId ?? null });
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: sessionKeys.listsRoot,
      refetchType: 'active',
    });
  }, [repos, currentUserId, queryClient]);
}
