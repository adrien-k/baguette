import { useEffect } from 'react';
import { sessionsService } from '../feathers.js';

const GIT_STATUS_FOLLOW_UP_MS = 2000;

function sessionIdsMatch(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/** Refetch git-derived session data when the agent finishes a turn. */
export function useInvalidateOnSessionTurnComplete(sessionId, invalidate) {
  useEffect(() => {
    if (sessionId == null || !invalidate) return;
    const followUpTimers = [];
    const onTurnComplete = (payload) => {
      if (!sessionIdsMatch(payload?.session_id, sessionId)) return;
      invalidate();
      // End-of-turn git commit/push can finish slightly after turn:complete (Cursor FINISHED).
      followUpTimers.push(window.setTimeout(() => invalidate(), GIT_STATUS_FOLLOW_UP_MS));
    };
    sessionsService.on('turn:complete', onTurnComplete);
    return () => {
      sessionsService.off('turn:complete', onTurnComplete);
      for (const t of followUpTimers) window.clearTimeout(t);
    };
  }, [sessionId, invalidate]);
}
