import { useState, useEffect, useCallback } from 'react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { isGlobalSession } from '@baguette/shared/session-scope.js';

/**
 * Branch commits vs session base. Fetches when `enabled` is true (Diff tab or Commits
 * panel). Loaded once per session while enabled; `refresh()` is the only later fetch.
 */
export function useSessionBranchCommits(session, enabled = false) {
  const sessionId = session?.id;
  const skip = !sessionId || isGlobalSession(session ?? {});
  const [commits, setCommits] = useState(undefined);
  const [loading, setLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    setCommits(undefined);
  }, [sessionId]);

  useEffect(() => {
    if (skip) {
      setCommits([]);
      setLoading(false);
      return;
    }
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    sessionsService
      .branchCommits(sessionId)
      .then((res) => {
        if (!cancelled) setCommits(res.commits ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setCommits([]);
          toastError('Failed to load commits', err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skip, sessionId, refreshNonce, enabled]);

  const refresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);

  return { commits, loading, refresh };
}
