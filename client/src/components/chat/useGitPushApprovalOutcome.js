import { useEffect, useState } from 'react';
import { sessionsService } from '../../feathers.js';

function sessionIdsMatch(payloadSessionId, sessionId) {
  if (payloadSessionId == null || sessionId == null) return false;
  return String(payloadSessionId) === String(sessionId);
}

function requestIdsMatch(payload, requestId) {
  if (!requestId) return true;
  const payloadRequestId = payload?.request_id ?? payload?.requestId;
  if (payloadRequestId == null) return false;
  return String(payloadRequestId) === String(requestId);
}

/**
 * While a GitPush tool result still says `approval_requested`, follow
 * session push events so the card reflects approve / cancel / push outcome.
 */
export function useGitPushApprovalOutcome(sessionId, approvalRequested, requestId = null) {
  const [outcome, setOutcome] = useState(null);
  const [failureMessage, setFailureMessage] = useState(null);

  useEffect(() => {
    setOutcome(null);
    setFailureMessage(null);
  }, [sessionId, approvalRequested, requestId]);

  useEffect(() => {
    if (!approvalRequested || sessionId == null) return;

    const match = (payload) =>
      sessionIdsMatch(payload?.session_id ?? payload?.sessionId, sessionId) &&
      requestIdsMatch(payload, requestId);

    const onStart = (payload) => {
      if (match(payload)) setOutcome('pushing');
    };
    const onComplete = (payload) => {
      if (!match(payload)) return;
      if (payload?.ok === false) {
        setOutcome('failed');
        setFailureMessage(
          typeof payload.message === 'string' && payload.message ? payload.message : 'Push failed'
        );
        return;
      }
      setOutcome('pushed');
      setFailureMessage(null);
    };
    const onCancel = (payload) => {
      if (match(payload)) {
        setOutcome('canceled');
        setFailureMessage(null);
      }
    };

    sessionsService.on('push:start', onStart);
    sessionsService.on('push:complete', onComplete);
    sessionsService.on('push:approval-cancelled', onCancel);
    return () => {
      sessionsService.off('push:start', onStart);
      sessionsService.off('push:complete', onComplete);
      sessionsService.off('push:approval-cancelled', onCancel);
    };
  }, [sessionId, approvalRequested, requestId]);

  return { outcome, failureMessage };
}
