import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api.js';

/**
 * @param {{ intervalMs?: number | null, onError?: (err: unknown) => void }} options
 */
export function useLiveMetrics({ intervalMs = null, onError } = {}) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (isRefresh = false) => {
      try {
        const data = await apiFetch('/api/settings/live-metrics');
        setInfo(data);
      } catch (err) {
        onError?.(err);
      } finally {
        if (!isRefresh) setLoading(false);
      }
    },
    [onError]
  );

  useEffect(() => {
    load();
    if (!intervalMs) return undefined;
    const id = setInterval(() => load(true), intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);

  return { info, loading, reload: () => load(true) };
}
