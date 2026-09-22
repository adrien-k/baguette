import { useState, useEffect, useCallback } from 'react';
import { reposService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import SearchableSelect from './SearchableSelect/index.jsx';

/** Sends the user to GitHub to install the App or change which repos it can access. */
function installHref() {
  const back = window.location.pathname + window.location.search;
  return `/auth/github/install?redirectTo=${encodeURIComponent(back)}`;
}

export default function RepoSearchInput({ value, onSelect, addedNames, trailing }) {
  const [orgs, setOrgs] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const getRepoOptions = useCallback(
    async (query) => {
      try {
        const res = await reposService.findRemote({ org: selectedOrg, query });
        return res.repos;
      } catch (err) {
        toastError('Failed to load repositories', err);
        return [];
      }
    },
    [selectedOrg]
  );

  // Accounts come from GitHub App installations — keep the current selection if it is still
  // installed, otherwise fall back to the first account returned.
  const loadOrgs = useCallback(() => {
    setLoadingOrgs(true);
    return reposService
      .findOrgs({})
      .then((list) => {
        setOrgs(list);
        setSelectedOrg((current) =>
          list.some((o) => o.login === current) ? current : (list[0]?.login ?? '')
        );
      })
      .catch((err) => toastError('Failed to load organizations', err))
      .finally(() => setLoadingOrgs(false));
  }, []);

  useEffect(() => {
    loadOrgs();
  }, [loadOrgs]);

  const handleRefresh = async () => {
    await reposService
      .refresh({})
      .catch((err) => toastError('Failed to refresh repositories', err));
    onSelect('');
    setRefreshKey((k) => k + 1);
    setOrgs([]);
    await loadOrgs();
  };

  const noInstallations = !loadingOrgs && orgs.length === 0;

  if (noInstallations) {
    return (
      <div className="flex-1">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-300 mb-1">No repositories connected yet</p>
          <p className="text-xs text-zinc-500 mb-3 max-w-md leading-relaxed">
            Install the Baguette GitHub App and choose which repositories it can access. You can
            pick a single repository, and change the selection at any time.
          </p>
          <div className="flex items-center gap-3">
            <a
              href={installHref()}
              className="inline-flex items-center gap-2 bg-amber-500 text-zinc-950 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-400 transition-colors"
            >
              Install on GitHub
            </a>
            <button
              type="button"
              onClick={handleRefresh}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Already installed? Refresh
            </button>
          </div>
        </div>
      </div>
    );
  }

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
            isOptionDisabled={(r) => addedNames.has(r.full_name)}
            renderOption={(r) => {
              const alreadyAdded = addedNames.has(r.full_name);
              return (
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-mono truncate ${alreadyAdded ? 'text-zinc-500' : ''}`}>
                    {r.full_name}
                  </span>
                  <span className="text-xs text-zinc-500 shrink-0">
                    {alreadyAdded ? 'Already added' : r.private ? 'private' : null}
                  </span>
                </div>
              );
            }}
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
        <span className="font-mono text-zinc-400">owner/repo</span> to search the full list. Only
        repositories you granted the Baguette GitHub App are listed.{' '}
        <a href={installHref()} className="text-amber-500 hover:text-amber-400">
          Manage repository access ↗
        </a>
      </p>
    </div>
  );
}
