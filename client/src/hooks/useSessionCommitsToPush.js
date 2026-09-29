import { useState, useEffect, useCallback } from 'react';
import { sessionsService } from '../feathers.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';

function shouldSkipCommitsToPush(session) {
  if (!session?.id) return true;
  if (session.is_global) return true;
  return (
    session.status === 'provisioning' ||
    session.status === 'archiving' ||
    session.status === 'archived'
  );
}

/** Unpushed commit count for the session push badge; refreshes when a turn completes. */
export function useSessionCommitsToPush(session) {
  const sessionId = session?.id;
  const skip = shouldSkipCommitsToPush(session);
  const [commitsToPush, setCommitsToPush] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const invalidate = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);
  useInvalidateOnSessionTurnComplete(sessionId, invalidate);

  useEffect(() => {
    if (skip) {
      setCommitsToPush(0);
      return;
    }
    let cancelled = false;
    sessionsService
      .sessionGitStatus(sessionId)
      .then((res) => {
        if (!cancelled) setCommitsToPush(res.commitsToPush ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [skip, sessionId, session?.last_reviewed_commit_sha, session?.review_status, refreshNonce]);

  const refreshCommitsToPush = useCallback(async () => {
    if (skip || !sessionId) {
      setCommitsToPush(0);
      return;
    }
    const status = await sessionsService.sessionGitStatus(sessionId);
    setCommitsToPush(status.commitsToPush ?? 0);
  }, [skip, sessionId]);

  return { commitsToPush, refreshCommitsToPush };
}
