import { useEffect } from 'react';
import { subscribeSseReconnect } from '../utils/sseReconnect.js';

/** Re-run `refetch` when the live event stream reconnects after a drop or hidden/offline. */
export function useRefetchOnSseReconnect(refetch, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    return subscribeSseReconnect(() => {
      refetch({ silent: true });
    });
  }, [enabled, refetch]);
}
