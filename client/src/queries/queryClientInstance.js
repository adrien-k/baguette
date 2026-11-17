import {
  createAppQueryClient,
  refetchActiveQueriesForResumeCatchUp,
  refetchActiveQueriesOnSseReconnect,
} from './queryClient.js';
import { startSseCacheBridge } from './sseCacheBridge.js';
import {
  subscribeSseReconnect,
  subscribeSseResumeCatchUp,
  subscribeSseStreamPaused,
} from '../utils/sseReconnect.js';

/**
 * App-wide singleton QueryClient. Module-level like the Feathers client in
 * `feathers.js`; tests create their own via `createAppQueryClient` instead.
 */
export const queryClient = createAppQueryClient();

/** SSE paused (hidden/offline) → mark cached server state stale for catch-up refetch. */
subscribeSseStreamPaused(() => {
  void queryClient.invalidateQueries({ refetchType: 'none' });
});

/** Tab resume: refetch while the stream is still down, before lifecycle calls setup(). */
subscribeSseResumeCatchUp(() => refetchActiveQueriesForResumeCatchUp(queryClient));

/** Visible-tab SSE drop (no pre-connect catch-up) → debounced refetch on connected. */
subscribeSseReconnect(() => refetchActiveQueriesOnSseReconnect(queryClient));

/** Feathers service events → query cache updates (sessions, agents, messages…). */
startSseCacheBridge(queryClient);
