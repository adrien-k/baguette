import { useState, useEffect, useCallback, useRef } from 'react';
import { reposService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import SearchableSelect from './SearchableSelect/index.jsx';

export default function RepoSearchInput({ value, onSelect, addedNames, trailing }) {
  const [orgs, setOrgs] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState('personal');
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const addedNamesRef = useRef(addedNames);
  useEffect(() => {
    addedNamesRef.current = addedNames;
  }, [addedNames]);

  const getRepoOptions = useCallback(
    async (query) => {
      try {
        const res = await reposService.findRemote({ org: selectedOrg, query });
        return res.repos.filter((r) => !addedNamesRef.current.has(r.full_name));
      } catch (err) {
        toastError('Failed to load repositories', err);
        return [];
      }
    },
    [selectedOrg]
  );

  useEffect(() => {
    reposService
      .findOrgs({})
      .then(setOrgs)
      .catch((err) => toastError('Failed to load organizations', err))
      .finally(() => setLoadingOrgs(false));
  }, []);

  const handleRefresh = async () => {
    await reposService
      .refresh({})
      .catch((err) => toastError('Failed to refresh repositories', err));
    onSelect('');
    setRefreshKey((k) => k + 1);
    setLoadingOrgs(true);
    setOrgs([]);
    reposService
      .findOrgs({})
      .then(setOrgs)
      .catch((err) => toastError('Failed to load organizations', err))
      .finally(() => setLoadingOrgs(false));
    setSelectedOrg('personal');
  };

  return (
    <div className="flex-1">
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {loadingOrgs && <span className="text-xs text-zinc-600">Loading…</span>}
        {!loadingOrgs &&
          orgs.map((org) => (
            <button
              key={org.login}
              type="button"
              onClick={() => setSelectedOrg(org.login)}
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                selectedOrg === org.login
                  ? 'bg-amber-500 text-zinc-950'
                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {org.name || org.login}
            </button>
          ))}
      </div>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-start min-w-0">
        <div className="flex-1 min-w-0">
          <SearchableSelect
            key={refreshKey}
            value={value}
            onChange={onSelect}
            getOptions={getRepoOptions}
            asyncRefetchKey={selectedOrg}
            disabled={loadingOrgs}
            placeholder="Search by name (optional)…"
            loadingText="Loading repositories…"
            emptyText="No repositories found"
            getOptionValue={(r) => r.full_name}
            getOptionLabel={(r) => r.full_name}
            renderOption={(r) => (
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono truncate">{r.full_name}</span>
                {r.private && <span className="text-xs text-zinc-500 shrink-0">private</span>}
              </div>
            )}
            renderSelected={(r) => <span className="font-mono">{r.full_name}</span>}
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loadingOrgs}
            title="Clear cache and reload"
            className="inline-flex items-center justify-center text-zinc-500 hover:text-zinc-300 text-sm leading-none px-1 py-2.5 disabled:opacity-40"
          >
            ↺
          </button>
          {trailing}
        </div>
      </div>
      <p className="text-xs text-zinc-500 mt-2 max-w-xl leading-relaxed">
        Lists up to <span className="text-zinc-400">20</span> repos per load. Empty field shows the
        20 most recently updated you can access; type a fragment of{' '}
        <span className="font-mono text-zinc-400">owner/repo</span> to search the full list.
        Personal is owner and direct collaborator repos only.
      </p>
    </div>
  );
}
