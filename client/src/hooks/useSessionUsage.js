import { useState, useCallback } from 'react';
import { sessionsService } from '../feathers.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';
import { scopeKeyOf } from '../utils/boundScope.js';
import { useScopedResource } from './useScopedResource.js';

/** Session token/cost breakdown; refetches when an agent turn completes. */
export function useSessionUsage(sessionId) {
  const requestedKey = sessionId == null ? '' : scopeKeyOf(sessionId);
  const [revision, setRevision] = useState(0);
  const invalidate = useCallback(() => {
    setRevision((n) => n + 1);
  }, []);
  useInvalidateOnSessionTurnComplete(sessionId, invalidate);

  const { data: usage, loading } = useScopedResource(requestedKey, {
    empty: null,
    load: () => sessionsService.sessionUsage(sessionId).catch(() => null),
    revision,
  });

  return { usage, loading };
}
