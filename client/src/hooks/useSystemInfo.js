import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api.js';
import { systemInfoKeys } from '../queries/keys.js';

/**
 * @param {{ onError?: (err: unknown) => void }} options
 */
export function useSystemInfo({ onError } = {}) {
  const query = useQuery({
    queryKey: systemInfoKeys.all,
    queryFn: () => apiFetch('/api/settings/system'),
  });

  // Callers keep `onError` stable (useCallback); guard anyway via the error
  // identity so an unstable callback cannot loop the effect.
  useEffect(() => {
    if (query.error) onError?.(query.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast once per error, not per callback identity
  }, [query.error]);

  return { info: query.data ?? null, loading: query.isPending, reload: query.refetch };
}
