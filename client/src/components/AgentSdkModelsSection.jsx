import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toastError } from '../utils/toastError.jsx';
import { fetchAgentSdkModels } from '../utils/fetchAgentSdkModels.js';

/**
 * Lists cached agent models for Settings → Agent (Claude or Cursor) with refresh.
 * Models are always loaded for a specific repository (repo-level + account keys).
 */
export default function AgentSdkModelsSection({ sdk, repoId }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadModels = useCallback(
    (refresh = false) => {
      if (!repoId) {
        setModels([]);
        setLoading(false);
        return Promise.resolve();
      }
      if (refresh) setRefreshing(true);
      else setLoading(true);
      return fetchAgentSdkModels(sdk, repoId, { refresh })
        .then((list) => setModels(list))
        .catch((err) => {
          if (refresh)
            toastError(`Failed to refresh ${sdk === 'cursor' ? 'Cursor' : 'Claude'} models`, err);
          else setModels([]);
        })
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [sdk, repoId]
  );

  useEffect(() => {
    loadModels(false);
  }, [loadModels]);

  if (!repoId) {
    return (
      <p className="text-xs text-faint">
        Select a repository scope (not &quot;All my repos&quot;) to load models for that repo.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-secondary">Available models</span>
        <button
          type="button"
          onClick={() => loadModels(true)}
          disabled={loading || refreshing}
          className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-heading disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh from provider
        </button>
      </div>
      {loading && !models.length ? (
        <p className="text-xs text-faint">Loading models…</p>
      ) : models.length === 0 ? (
        <p className="text-xs text-faint">No models loaded yet. Try refresh.</p>
      ) : (
        <ul className="rounded-lg border border-line bg-page/50 divide-y divide-line/80 max-h-48 overflow-y-auto">
          {models.map((m) => (
            <li key={m.id} className="px-3 py-2 text-sm">
              <span className="text-heading">{m.display_name}</span>
              {m.description ? (
                <span className="block text-xs text-faint mt-0.5">{m.description}</span>
              ) : (
                <span className="block text-xs text-faint font-mono mt-0.5">{m.id}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
