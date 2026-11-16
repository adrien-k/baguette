import { createAppQueryClient, refetchActiveQueriesOnSseReconnect } from './queryClient.js';
import { startSseCacheBridge } from './sseCacheBridge.js';
import { subscribeSseReconnect } from '../utils/sseReconnect.js';

/**
 * App-wide singleton QueryClient. Module-level like the Feathers client in
 * `feathers.js`; tests create their own via `createAppQueryClient` instead.
 */
export const queryClient = createAppQueryClient();

/** SSE stream reconnected (drop, tab visible, online again) → refetch stale active queries. */
subscribeSseReconnect(() => refetchActiveQueriesOnSseReconnect(queryClient));

/** Feathers service events → query cache updates (sessions, agents, messages…). */
startSseCacheBridge(queryClient);
