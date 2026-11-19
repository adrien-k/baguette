import { useCallback } from 'react';
import { reposService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import SearchableSelect from './SearchableSelect/index.jsx';
import {
  isPublicRepoSearchQuery,
  sortRemoteReposForPicker,
} from '../utils/remoteRepoPickerSort.js';

export default function PublicRepoSearchInput({ value, onSelect, addedNames, trailing }) {
  const getRepoOptions = useCallback(
    async (query) => {
      if (!isPublicRepoSearchQuery(query)) return [];
      try {
        const res = await reposService.findPublicRemote({ query: query.trim() });
        return sortRemoteReposForPicker(res.repos, addedNames);
      } catch (err) {
        toastError('Failed to search public repositories', err);
        return [];
      }
    },
    [addedNames]
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-start min-w-0">
        <div className="flex-1 min-w-0">
          <SearchableSelect
            value={value}
            onChange={onSelect}
            getOptions={getRepoOptions}
            placeholder="Search public repos (owner/repo or name)…"
            loadingText="Searching…"
            emptyText="Type to search public repositories"
            getOptionValue={(r) => r.full_name}
            getOptionLabel={(r) => r.full_name}
            isOptionDisabled={(r) => addedNames.has(r.full_name)}
            renderOption={(r) => {
              const alreadyAdded = addedNames.has(r.full_name);
              return (
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-mono truncate ${alreadyAdded ? 'text-faint' : ''}`}>
                    {r.full_name}
                  </span>
                  <span className="text-xs text-faint shrink-0">
                    {alreadyAdded ? 'Already added' : 'public'}
                  </span>
                </div>
              );
            }}
            renderSelected={(r) => <span className="font-mono">{r.full_name}</span>}
          />
        </div>
        {trailing ? <div className="flex gap-2 shrink-0">{trailing}</div> : null}
      </div>
      <p className="text-xs text-faint max-w-xl leading-relaxed">
        Finds public repositories on GitHub by exact{' '}
        <span className="font-mono text-fg-muted">owner/repo</span> or a name fragment (2+
        characters). Private repos still need App or PAT access above.
      </p>
    </div>
  );
}
