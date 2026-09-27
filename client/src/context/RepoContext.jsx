import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { useGetRepos } from '../hooks/useGetRepos.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { ALL_REPOS, GLOBAL_SCOPE } from '@baguette/shared/session-scope.js';
import { duplicateRepoDisplayNames, formatRepoLabel } from '../utils/repoDisplayName.js';

export { ALL_REPOS, GLOBAL_SCOPE };

const RepoContext = createContext(null);

export function RepoProvider({ children }) {
  const { user } = useAuth();
  const { repos, loading, refetch } = useGetRepos(!!user?.approved);
  const [selectedRepo, setSelectedRepo] = useState(null);

  // Drop selection if that repo is no longer available
  useEffect(() => {
    if (loading || !selectedRepo || selectedRepo === ALL_REPOS || selectedRepo === GLOBAL_SCOPE)
      return;
    const exists = repos.some((r) => r.full_name === selectedRepo);
    if (!exists) setSelectedRepo(null);
  }, [loading, repos, selectedRepo]);

  const duplicateDisplayNames = useMemo(
    () => duplicateRepoDisplayNames(repos.map((r) => r.full_name)),
    [repos]
  );

  const uniqueLabel = useCallback(
    (fullName) => formatRepoLabel(fullName, duplicateDisplayNames),
    [duplicateDisplayNames]
  );

  return (
    <RepoContext.Provider
      value={{ repos, loading, refetch, selectedRepo, setSelectedRepo, uniqueLabel }}
    >
      {children}
    </RepoContext.Provider>
  );
}

export function useRepoContext() {
  return useContext(RepoContext);
}
