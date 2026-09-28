import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiFetch } from '../api.js';
import { toastError } from '../utils/toastError.jsx';

/**
 * Lists cached agent models for Settings → Agent (Claude or Cursor) with refresh.
 */
export default function AgentSdkModelsSection({ sdk, credentialConfigured = true }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadModels = useCallback(
    (refresh = false) => {
      if (sdk === 'cursor' && !credentialConfigured) {
        setModels([]);
        setLoading(false);
        return Promise.resolve();
      }
      const getUrl = sdk === 'cursor' ? '/api/settings/models?sdk=cursor' : '/api/settings/models';
      const refreshUrl =
        sdk === 'cursor'
          ? '/api/settings/models/refresh?sdk=cursor'
          : '/api/settings/models/refresh';
      const url = refresh ? refreshUrl : getUrl;
      if (refresh) setRefreshing(true);
      else setLoading(true);
      return apiFetch(url, refresh ? { method: 'POST' } : undefined)
        .then((d) => setModels(d.models || []))
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
    [sdk, credentialConfigured]
  );

  useEffect(() => {
    loadModels(false);
  }, [loadModels]);

  if (sdk === 'cursor' && !credentialConfigured) {
    return (
      <p className="text-xs text-faint">
        Save a Cursor API key above to load and refresh available models.
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
