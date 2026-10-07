import { useCallback, useEffect, useMemo, useState } from 'react';
import { reposService, usersService } from '../feathers.js';
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

  const load = useCallback(() => {
    setLoading(true);
    return fetchAvailableAgentSdks(repoId)
      .then((list) => setSdks(list))
      .catch((err) => {
        setSdks([]);
        toastError('Failed to load available agents', err);
      })
      .finally(() => setLoading(false));
  }, [repoId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onCredentialsChange = () => load();
    usersService.on('patched', onCredentialsChange);
    reposService.on('patched', onCredentialsChange);
    return () => {
      usersService.off('patched', onCredentialsChange);
      reposService.off('patched', onCredentialsChange);
    };
  }, [load]);

  const keys = useMemo(() => sdks.map((s) => s.key), [sdks]);
  return { sdks, keys, loading };
}
