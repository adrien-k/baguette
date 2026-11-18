import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usageService } from '../feathers.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';
import { subscriptionLimitsKeys } from '../queries/keys.js';
import { toastError } from '../utils/toastError.jsx';

const SUBSCRIPTION_LIMITS_REFRESH_MS = 60_000;

/**
 * Plan limits per provider (Claude, Cursor), re-read every 60s while open. The server caches
 * ~55s; `sync()` forces a
 * fresh fetch and writes it into the query cache.
 */
export function useSubscriptionLimits(sessionId, agentSdk, agentConfigId) {
  const queryClient = useQueryClient();
  const queryKey = subscriptionLimitsKeys.provider(agentSdk, agentConfigId);
  const [syncing, setSyncing] = useState(false);
  const request = { agent_sdk: agentSdk, agent_config_id: agentConfigId ?? null };

  const query = useQuery({
    queryKey,
    queryFn: () => usageService.subscriptionLimits(request),
    enabled: Boolean(agentSdk),
    // Auto-refresh while the card is open; TanStack pauses it in hidden tabs.
    refetchInterval: SUBSCRIPTION_LIMITS_REFRESH_MS,
  });

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const fresh = await usageService.subscriptionLimits({
        agent_sdk: agentSdk,
        agent_config_id: agentConfigId ?? null,
        refresh: true,
      });
      queryClient.setQueryData(queryKey, fresh);
    } catch (err) {
      toastError('Failed to refresh subscription limits', err);
    } finally {
      setSyncing(false);
    }
  }, [agentSdk, agentConfigId, queryClient, queryKey]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: subscriptionLimitsKeys.all,
      refetchType: 'active',
    });
  }, [queryClient]);
  useInvalidateOnSessionTurnComplete(sessionId, invalidate);

  return {
    providers: query.data?.providers ?? [],
    loading: query.isPending,
    error: query.error,
    syncing,
    sync,
  };
}
