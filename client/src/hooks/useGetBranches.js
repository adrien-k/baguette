import { useState, useEffect, useCallback } from 'react';
import { toastError } from '../utils/toastError.jsx';
import { reposService } from '../feathers.js';
import { useRefetchOnSseReconnect } from './useRefetchOnSseReconnect.js';

export function useGetBranches(repo) {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [clearingCache, setClearingCache] = useState(false);

  const refetch = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);

  useRefetchOnSseReconnect(refetch, Boolean(repo?.full_name));

  useEffect(() => {
    if (!repo?.full_name) {
      setBranches([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    reposService
      .branches(repo.full_name)
      .then((d) => {
        if (cancelled) return;
        const all = d.branches ?? [];
        const defaultBranch = repo.default_branch;
        setBranches(
          defaultBranch && all.includes(defaultBranch)
            ? [defaultBranch, ...all.filter((b) => b !== defaultBranch)]
            : all
        );
      })
      .catch((err) => toastError('Failed to load branches', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo?.full_name, repo?.default_branch, reloadNonce]);

  const clearCacheAndReload = useCallback(async () => {
    if (!repo?.full_name) return;
    setClearingCache(true);
    try {
      await reposService.refresh({});
      setReloadNonce((n) => n + 1);
    } catch (err) {
      toastError('Failed to clear GitHub cache', err);
    } finally {
      setClearingCache(false);
    }
  }, [repo?.full_name]);

  return { branches, loading, clearCacheAndReload, clearingCache };
}
