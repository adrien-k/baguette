import { QueryClient } from '@tanstack/react-query';
import { isFeathersError } from '../utils/feathersErrors.js';

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
        refetchOnWindowFocus: true,
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
 * Refetch every mounted ("active") query after the SSE stream reconnects.
 * Debounced upstream by `notifySseReconnect`; staleTime filters entries whose
 * data is still fresh, so this is cheap for recently-fetched queries.
 */
export function refetchActiveQueriesOnSseReconnect(queryClient) {
  void queryClient.refetchQueries({ type: 'active', stale: true });
}
