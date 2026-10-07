import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';

function sessionIdsMatch(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/** True while a sessions.push (manual or end-of-turn auto-push) is in flight for this session. */
export function useSessionPushInProgress(sessionId) {
  const [ssePushing, setSsePushing] = useState(false);
  const [localPushing, setLocalPushing] = useState(false);
  const localPushRef = useRef(false);

  useEffect(() => {
    setSsePushing(false);
    setLocalPushing(false);
    localPushRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (sessionId == null) return;
    const onStart = (payload) => {
      if (sessionIdsMatch(payload?.session_id, sessionId)) setSsePushing(true);
    };
    const onComplete = (payload) => {
      if (!sessionIdsMatch(payload?.session_id, sessionId)) return;
      setSsePushing(false);
      if (payload?.ok === false && !localPushRef.current) {
        const err = { message: payload.message || 'Push failed' };
        if (payload.conflict) {
          toastError('Auto-push failed — use Git Sync to resolve conflicts first', err);
        } else {
          toastError('Auto-push failed', err);
        }
      }
    };
    sessionsService.on('push:start', onStart);
    sessionsService.on('push:complete', onComplete);
    return () => {
      sessionsService.off('push:start', onStart);
      sessionsService.off('push:complete', onComplete);
    };
  }, [sessionId]);

  const beginLocalPush = useCallback(() => {
    localPushRef.current = true;
    setLocalPushing(true);
  }, []);
  const endLocalPush = useCallback(() => {
    localPushRef.current = false;
    setLocalPushing(false);
  }, []);

  return {
    pushing: ssePushing || localPushing,
    beginLocalPush,
    endLocalPush,
  };
}
