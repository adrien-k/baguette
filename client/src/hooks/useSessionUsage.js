import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sessionsService } from '../feathers.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';
import { sessionUsageKeys } from '../queries/keys.js';

/** Session token/cost breakdown; invalidated when an agent turn completes. */
export function useSessionUsage(sessionId) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: sessionUsageKeys.session(sessionId),
    queryFn: () => sessionsService.sessionUsage(sessionId),
    enabled: sessionId != null,
  });

  const invalidate = useCallback(() => {
    if (sessionId == null) return;
    void queryClient.invalidateQueries({
      queryKey: sessionUsageKeys.session(sessionId),
      refetchType: 'active',
    });
  }, [sessionId, queryClient]);
  useInvalidateOnSessionTurnComplete(sessionId, invalidate);

  return { usage: sessionId != null ? (query.data ?? null) : null, loading: query.isPending };
}
