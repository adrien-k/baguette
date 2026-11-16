import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reposService } from '../feathers.js';
import { repoKeys } from '../queries/keys.js';
import { feathersFind } from '../queries/feathersFinders.js';
import { toastFeathersError } from '../utils/toastError.jsx';

/**
 * Repos visible to the current user. Realtime created/removed events and SSE
 * reconnect refetches are handled by the central `sseCacheBridge` and the
 * global reconnect wiring.
 */
export function useGetRepos(enabled = true) {
  const [clearingCache, setClearingCache] = useState(false);

  const query = useQuery({
    queryKey: repoKeys.all,
    queryFn: () => feathersFind(reposService, {}),
    enabled,
  });

  useEffect(() => {
    if (query.error) toastFeathersError('Failed to load repositories', query.error);
  }, [query.error]);

  const refetch = (opts) => {
    // `silent` callers only wanted no loading spinner; React Query refetch
    // keeps showing existing data either way.
    void opts;
    return query.refetch().then(() => undefined);
  };

  const clearCacheAndReload = async () => {
    setClearingCache(true);
    try {
      await reposService.refresh({});
      await query.refetch();
    } catch (err) {
      toastFeathersError('Failed to clear GitHub cache', err);
    } finally {
      setClearingCache(false);
    }
  };

  return {
    repos: query.data ?? [],
    loading: enabled && query.isPending,
    refetch,
    clearCacheAndReload,
    clearingCache,
  };
}
