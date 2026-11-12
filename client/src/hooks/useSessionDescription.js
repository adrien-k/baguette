import { useEffect, useState } from 'react';
import { sessionsService } from '../feathers.js';

/**
 * Limited description projection for the standalone description page
 * (`/session/:id/description`). Loads for any signed-in user — the session
 * does not have to be shared with the viewer.
 */
export function useSessionDescription(sessionId) {
  const [state, setState] = useState({ loading: true, error: null, description: null });

  useEffect(() => {
    if (sessionId == null || sessionId === '') {
      setState({ loading: false, error: null, description: null });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, error: null, description: null });
    sessionsService
      .getDescription(sessionId)
      .then((description) => {
        if (!cancelled) setState({ loading: false, error: null, description });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ loading: false, error: err, description: null });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return state;
}
