import { useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loopsService } from '../feathers.js';
import { loopKeys } from '../queries/keys.js';
import { feathersFind } from '../queries/feathersFinders.js';
import { toastError } from '../utils/toastError.jsx';

/**
 * Loops for the current picker scope (`query` from Dashboard/Session sidebar).
 * Loop created/patched/removed SSE events invalidate the loops cache via the
 * central bridge, so schedule fields stay fresh.
 */
export function useGetLoops(query) {
  const enabled = Boolean(query);

  const q = useQuery({
    queryKey: loopKeys.list(query ?? {}),
    queryFn: () => feathersFind(loopsService, { ...query, $limit: 100 }),
    enabled,
  });

  const { refetch } = q;

  useEffect(() => {
    if (q.error) toastError('Failed to load loops', q.error);
  }, [q.error]);

  const reload = useCallback(() => {
    if (!enabled) return;
    void refetch();
  }, [enabled, refetch]);

  return {
    loops: enabled ? (q.data ?? []) : [],
    loaded: !enabled || !q.isPending,
    reload,
  };
}
