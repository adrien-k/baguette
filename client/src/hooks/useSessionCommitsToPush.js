import { useState, useEffect, useCallback } from 'react';
import { sessionsService } from '../feathers.js';
import { shouldSkipSessionCommitsToPush } from '../utils/sessionPushGitStatus.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';

/** Unpushed commit count for the session push badge; refreshes when a turn completes. */
export function useSessionCommitsToPush(session) {
  const sessionId = session?.id;
  const skip = shouldSkipSessionCommitsToPush(session);
  const [commitsToPush, setCommitsToPush] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const invalidate = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);
  useInvalidateOnSessionTurnComplete(sessionId, invalidate);

  useEffect(() => {
    setCommitsToPush(0);
  }, [sessionId]);

  useEffect(() => {
    if (sessionId == null) return;
    const onPushComplete = (payload) => {
      if (String(payload?.session_id) !== String(sessionId)) return;
      invalidate();
    };
    sessionsService.on('push:complete', onPushComplete);
    return () => {
      sessionsService.off('push:complete', onPushComplete);
    };
  }, [sessionId, invalidate]);

  useEffect(() => {
    if (skip) {
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
  }, [skip, sessionId, session?.review_status, refreshNonce]);

  const refreshCommitsToPush = useCallback(async () => {
    if (skip || !sessionId) {
      return;
    }
    const status = await sessionsService.sessionGitStatus(sessionId);
    setCommitsToPush(status.commitsToPush ?? 0);
  }, [skip, sessionId]);

  return { commitsToPush, refreshCommitsToPush };
}
