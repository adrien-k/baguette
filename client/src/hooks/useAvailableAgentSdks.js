import { useEffect, useMemo, useState } from 'react';
import { toastError } from '../utils/toastError.jsx';
import { fetchAvailableAgentSdks } from '../utils/fetchAgentSdkModels.js';

/**
 * Registered agent SDKs that are enabled for this user (and repo, when `repoId` is set).
 * @param {number|string} [repoId]
 * @returns {{ sdks: Array<{ key: string, label: string }>, keys: string[], loading: boolean }}
 */
export function useAvailableAgentSdks(repoId) {
  const [sdks, setSdks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAvailableAgentSdks(repoId)
      .then((list) => {
        if (!cancelled) setSdks(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setSdks([]);
          toastError('Failed to load available agents', err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  const keys = useMemo(() => sdks.map((s) => s.key), [sdks]);
  return { sdks, keys, loading };
}
