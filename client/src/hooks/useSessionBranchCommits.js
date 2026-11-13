import { useState, useCallback } from 'react';
import { sessionsService } from '../feathers.js';
import { toastFeathersError } from '../utils/toastError.jsx';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';
import { scopeKeyOf } from '../utils/boundScope.js';
import { useScopedResource } from './useScopedResource.js';

/**
 * Branch commits vs session base. Fetches when `enabled` is true (Diff tab or Commits
 * panel). Loaded once per session while enabled; `refresh()` is the only later fetch.
 */
export function useSessionBranchCommits(session, enabled = false) {
  const sessionId = session?.id;
  const skip = !sessionId || isGlobalSession(session ?? {});
  const requestedKey = skip || !sessionId ? '' : scopeKeyOf(sessionId);
  const [revision, setRevision] = useState(0);

  const invalidate = useCallback(() => {
    setRevision((n) => n + 1);
  }, []);
  useInvalidateOnSessionTurnComplete(sessionId, invalidate);

  const { data: commits, loading } = useScopedResource(requestedKey, {
    empty: undefined,
    enabled: enabled && !skip,
    revision,
    load: async () => {
      try {
        const res = await sessionsService.branchCommits(sessionId);
        return res.commits ?? [];
      } catch (err) {
        toastFeathersError('Failed to load commits', err);
        return [];
      }
    },
  });

  const refresh = useCallback(() => {
    setRevision((n) => n + 1);
  }, []);

  return {
    commits: skip ? [] : commits,
    loading: skip ? false : loading,
    refresh,
  };
}
