import { useState, useEffect, useCallback } from 'react';
import { toastError } from '../utils/toastError.jsx';
import { reposService } from '../feathers.js';
import { useRefetchOnSseReconnect } from './useRefetchOnSseReconnect.js';

export function useGetRepos(enabled = true) {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clearingCache, setClearingCache] = useState(false);

  const refetch = useCallback(() => {
    setLoading(true);
    return reposService
      .find()
      .then((data) => setRepos(data))
      .catch((err) => toastError('Failed to load repositories', err))
      .finally(() => setLoading(false));
  }, []);

  const clearCacheAndReload = useCallback(async () => {
    setClearingCache(true);
    try {
      await reposService.refresh({});
      await refetch();
    } catch (err) {
      toastError('Failed to clear GitHub cache', err);
    } finally {
      setClearingCache(false);
    }
  }, [refetch]);

  useRefetchOnSseReconnect(refetch, enabled);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    refetch();

    const onCreated = () => refetch();
    const onRemoved = () => refetch();

    reposService.on('created', onCreated);
    reposService.on('removed', onRemoved);

    return () => {
      reposService.off('created', onCreated);
      reposService.off('removed', onRemoved);
    };
  }, [enabled, refetch]);

  return { repos, loading, refetch, clearCacheAndReload, clearingCache };
}
