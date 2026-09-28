import { useEffect } from 'react';
import { sessionsService } from '../feathers.js';

/** Refetch git-derived session data when the agent finishes a turn. */
export function useInvalidateOnSessionTurnComplete(sessionId, invalidate) {
  useEffect(() => {
    if (sessionId == null || !invalidate) return;
    const onTurnComplete = (payload) => {
      if (payload?.session_id !== sessionId) return;
      invalidate();
    };
    sessionsService.on('turn:complete', onTurnComplete);
    return () => sessionsService.off('turn:complete', onTurnComplete);
  }, [sessionId, invalidate]);
}
