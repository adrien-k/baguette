import { createAppQueryClient } from './queryClient.js';
import { scheduleReconnectResync } from './reconnectResync.js';
import { startSseCacheBridge } from './sseCacheBridge.js';
import { subscribeSseReconnect, subscribeSseStreamPaused } from '../utils/sseReconnect.js';

/**
 * App-wide singleton QueryClient. Module-level like the Feathers client in
 * `feathers.js`; tests create their own via `createAppQueryClient` instead.
 */
export const queryClient = createAppQueryClient();

/** SSE paused (hidden/offline) → mark cached server state stale for the next read. */
subscribeSseStreamPaused(() => {
  void queryClient.invalidateQueries({ refetchType: 'none' });
});

/**
 * Stream reconnected (tab visible again, or a drop while visible). Reload active
 * queries from the server; events during that reload apply after the snapshot.
 */
subscribeSseReconnect(() => scheduleReconnectResync(queryClient));

/** Feathers service events → query cache updates (sessions, agents, messages…). */
startSseCacheBridge(queryClient);
