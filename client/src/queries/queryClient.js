import { QueryClient } from '@tanstack/react-query';
import { isFeathersError } from '../utils/feathersErrors.js';
import { isSseFocusRefetchSuppressed } from '../utils/sseReconnect.js';

/** How long cached data is considered fresh (no refetch on mount/focus). */
const STALE_TIME_MS = 30_000;
/** Infinite retry budget for unexpected failures; 4xx errors never retry. */
const MAX_RETRIES = 3;

/** Never retry client errors — they will fail identically (auth, 404, validation…). */
function shouldRetry(failureCount, error) {
  if (isFeathersError(error) && error.code < 500) return false;
  return failureCount < MAX_RETRIES;
}

/**
 * App-wide TanStack Query client. Server state for all Feathers services lives
 * here; the Feathers fetch+SSE transport keeps running underneath it.
 */
export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        refetchOnWindowFocus: () => !isSseFocusRefetchSuppressed(),
        refetchOnReconnect: true,
        retry: shouldRetry,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * Active-query catch-up while the SSE stream is still paused (before setup).
 * A `setQueryData` during an in-flight queryFn is reapplied afterward — TanStack
 * replaces the cache with the HTTP snapshot when the fetch resolves.
 * `cancelRefetch: true` drops a focus or pre-hide request so the queryFn runs
 * after the resume delay, not against that earlier snapshot.
 */
export async function refetchActiveQueriesForResumeCatchUp(queryClient) {
  /** @type {Map<string, unknown>} */
  const manualWrites = new Map();
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || !event.action?.manual) return;
    manualWrites.set(event.query.queryHash, event.action.data);
  });
  try {
    await queryClient.refetchQueries({ type: 'active' }, { cancelRefetch: true });
  } finally {
    unsubscribe();
  }
  for (const query of queryClient.getQueryCache().findAll({ type: 'active' })) {
    if (!manualWrites.has(query.queryHash)) continue;
    queryClient.setQueryData(query.queryKey, manualWrites.get(query.queryHash));
  }
}

/**
 * Refetch mounted queries after a visible-tab SSE drop (stream was never paused).
 * `cancelRefetch: false` avoids cancelling an in-flight fetch and racing live events.
 */
export function refetchActiveQueriesOnSseReconnect(queryClient) {
  void queryClient.refetchQueries({ type: 'active' }, { cancelRefetch: false });
}
