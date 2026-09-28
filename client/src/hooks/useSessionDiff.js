import { useState, useEffect, useCallback } from 'react';
import { sessionsService } from '../feathers.js';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';

/**
 * Branch or single-commit diff text. Only fetches while the Diff view is mounted
 * (`enabled` is true). `refresh()` and turn completion are the only later fetches.
 */
export function useSessionDiff(session, selectedCommit = 'all', enabled = true) {
  const sessionId = session?.id;
  const skip = !sessionId || isGlobalSession(session ?? {});
  const isSingleCommit = selectedCommit && selectedCommit !== 'all';
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const invalidate = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);
  useInvalidateOnSessionTurnComplete(sessionId, invalidate);

  useEffect(() => {
    setDiff(null);
    setError(null);
  }, [sessionId, selectedCommit]);

  useEffect(() => {
    if (skip || !enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const payload = isSingleCommit ? { id: sessionId, commit: selectedCommit } : sessionId;
    sessionsService
      .diff(payload)
      .then((res) => {
        if (!cancelled) setDiff(res.diff || '');
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load diff');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skip, sessionId, enabled, isSingleCommit, selectedCommit, refreshNonce]);

  const refresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);

  return { diff, loading, error, refresh };
}
