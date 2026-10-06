import { useState, useEffect, useCallback } from 'react';
import { toastFeathersError } from '../utils/toastError.jsx';
import { reposService } from '../feathers.js';
import { useRefetchOnSseReconnect } from './useRefetchOnSseReconnect.js';

function sortBranches(all, defaultBranch) {
  return defaultBranch && all.includes(defaultBranch)
    ? [defaultBranch, ...all.filter((b) => b !== defaultBranch)]
    : all;
}

export function useGetBranches(repo) {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [clearingCache, setClearingCache] = useState(false);

  const loadBranches = useCallback(
    ({ silent = false } = {}) => {
      if (!repo?.full_name) {
        setBranches([]);
        return Promise.resolve();
      }
      if (!silent) setLoading(true);
      return reposService
        .branches(repo.full_name)
        .then((d) => {
          const all = d.branches ?? [];
          setBranches(sortBranches(all, repo.default_branch));
        })
        .catch((err) => {
          if (!silent) toastFeathersError('Failed to load branches', err);
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [repo]
  );

  const refetch = useCallback(
    (opts) => {
      void loadBranches(opts);
    },
    [loadBranches]
  );

  useRefetchOnSseReconnect(refetch, Boolean(repo?.full_name));

  useEffect(() => {
    if (!repo?.full_name) {
      setBranches([]);
      return;
    }
    void loadBranches();
  }, [repo?.full_name, reloadNonce, loadBranches]);

  const clearCacheAndReload = useCallback(async () => {
    if (!repo?.full_name) return;
    setClearingCache(true);
    try {
      await reposService.refresh({});
      setReloadNonce((n) => n + 1);
    } catch (err) {
      toastFeathersError('Failed to clear GitHub cache', err);
    } finally {
      setClearingCache(false);
    }
  }, [repo?.full_name]);

  return { branches, loading, clearCacheAndReload, clearingCache };
}
