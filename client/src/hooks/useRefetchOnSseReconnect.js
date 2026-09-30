import { useEffect } from 'react';
import { subscribeSseReconnect } from '../utils/sseReconnect.js';

/** Re-run `refetch` when the live event stream reconnects after hidden/offline. */
export function useRefetchOnSseReconnect(refetch, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    return subscribeSseReconnect(() => {
      refetch();
    });
  }, [enabled, refetch]);
}
