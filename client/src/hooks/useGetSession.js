import { useState, useEffect } from 'react';
import { sessionsService } from '../feathers.js';

/**
 * Returns a single session by id or short_id. Updates in realtime (patched, removed).
 */
export function useGetSession(sessionId) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setLoading(false);
      return;
    }
    let cancelled = false;

    sessionsService
      .find({ query: { short_id: sessionId } })
      .then((result) => {
        if (cancelled) return;
        const s = result.data?.[0] ?? result[0];
        if (!s) throw new Error('Session not found');
        setSession(s);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err);
          setSession(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const onPatched = (updated) => {
      const matches = updated.id === sessionId || updated.short_id === sessionId;
      if (!matches) return;
      setSession((prev) => (prev ? { ...prev, ...updated } : updated));
    };
    const onRemoved = (removed) => {
      const matches = removed.id === sessionId || removed.short_id === sessionId;
      if (!matches) return;
      // Soft-archive: keep the row and wait for `patched` if cleanup is still running.
      if (removed.archived_at) {
        setSession((prev) => (prev ? { ...prev, ...removed } : removed));
      }
    };

    sessionsService.on('patched', onPatched);
    sessionsService.on('removed', onRemoved);

    return () => {
      cancelled = true;
      sessionsService.off('patched', onPatched);
      sessionsService.off('removed', onRemoved);
    };
  }, [sessionId]);

  return { session, loading, error };
}
