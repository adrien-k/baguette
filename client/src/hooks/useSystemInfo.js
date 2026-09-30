import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api.js';

/**
 * @param {{ onError?: (err: unknown) => void }} options
 */
export function useSystemInfo({ onError } = {}) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (isRefresh = false) => {
      try {
        const data = await apiFetch('/api/settings/system');
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
  }, [load]);

  return { info, loading, reload: () => load(true) };
}
