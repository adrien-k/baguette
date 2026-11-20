import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sessionPlansService } from '../feathers.js';
import { sessionPlanKeys } from '../queries/keys.js';
import { findAllPages } from '../utils/feathersFindAll.js';
import { toastError } from '../utils/toastError.jsx';

const EMPTY_PLANS = [];

/**
 * Plan rows for one session (all pages). Plan SSE events invalidate the
 * session's plan cache entries via the central `sseCacheBridge`.
 */
export function useGetSessionPlans(sessionId, { enabled = true } = {}) {
  const active = enabled && sessionId != null;

  const query = useQuery({
    queryKey: sessionPlanKeys.session(sessionId),
    queryFn: () =>
      findAllPages(sessionPlansService, {
        session_id: sessionId,
        $sort: { ref: 1 },
      }),
    enabled: active,
  });

  useEffect(() => {
    if (query.error) toastError('Failed to load plans', query.error);
  }, [query.error]);

  return {
    plans: active ? (query.data ?? EMPTY_PLANS) : EMPTY_PLANS,
    loading: active && query.isPending,
    reload: query.refetch,
  };
}
