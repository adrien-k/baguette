import { QueryClient } from '@tanstack/react-query';
import { isFeathersError } from '../utils/feathersErrors.js';

/** How long cached data is considered fresh (no refetch on mount). */
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
 *
 * Focus and browser-online refetch stay off. Those refetches race the SSE
 * cache bridge and replace a live cache with a stale HTTP snapshot. Reconnect
 * reloads active queries in one place (`reconnectResync.js`) instead.
 */
export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: shouldRetry,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
