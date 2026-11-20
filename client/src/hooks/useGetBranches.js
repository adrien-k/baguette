import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toastFeathersError } from '../utils/toastError.jsx';
import { reposService } from '../feathers.js';
import { branchKeys } from '../queries/keys.js';

function sortBranches(all, defaultBranch) {
  return defaultBranch && all.includes(defaultBranch)
    ? [defaultBranch, ...all.filter((b) => b !== defaultBranch)]
    : all;
}

/** Branch list for one repo (GitHub-backed custom method). */
export function useGetBranches(repo) {
  const fullName = repo?.full_name;
  const [clearingCache, setClearingCache] = useState(false);

  const query = useQuery({
    queryKey: branchKeys.repo(fullName),
    queryFn: async () => {
      const d = await reposService.branches(fullName);
      return sortBranches(d.branches ?? [], repo.default_branch);
    },
    enabled: Boolean(fullName),
  });

  useEffect(() => {
    if (query.error) toastFeathersError('Failed to load branches', query.error);
  }, [query.error]);

  const clearCacheAndReload = async () => {
    if (!fullName) return;
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
    branches: fullName ? (query.data ?? []) : [],
    loading: Boolean(fullName) && query.isPending,
    clearCacheAndReload,
    clearingCache,
  };
}
