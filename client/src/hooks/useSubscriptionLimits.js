import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usageService } from '../feathers.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';
import { subscriptionLimitsKeys } from '../queries/keys.js';
import { toastError } from '../utils/toastError.jsx';

const SUBSCRIPTION_LIMITS_REFRESH_MS = 60_000;

/**
 * Plan limits per provider (Claude, Cursor), re-read every 60s while open. The server caches
 * ~55s; `sync()` forces a fresh fetch and writes it into the query cache.
 */
export function useSubscriptionLimits(sessionId, agentSdk, agentConfigId) {
  const queryClient = useQueryClient();
  const queryKey = subscriptionLimitsKeys.provider(agentSdk, agentConfigId);
  const request = { agent_sdk: agentSdk, agent_config_id: agentConfigId ?? null };

  const query = useQuery({
    queryKey,
    queryFn: () => usageService.subscriptionLimits(request),
    enabled: Boolean(agentSdk),
    // Auto-refresh while the card is open; TanStack pauses it in hidden tabs.
    refetchInterval: SUBSCRIPTION_LIMITS_REFRESH_MS,
  });

  const syncMutation = useMutation({
    mutationFn: () => usageService.subscriptionLimits({ ...request, refresh: true }),
    onSuccess: (fresh) => queryClient.setQueryData(queryKey, fresh),
    onError: (err) => toastError('Failed to refresh subscription limits', err),
  });

  useInvalidateOnSessionTurnComplete(sessionId, () => {
    void queryClient.invalidateQueries({
      queryKey: subscriptionLimitsKeys.all,
      refetchType: 'active',
    });
  });

  return {
    providers: query.data?.providers ?? [],
    loading: query.isPending,
    error: query.error,
    syncing: syncMutation.isPending,
    sync: syncMutation.mutate,
  };
}
