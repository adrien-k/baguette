import { useState, useEffect } from 'react';
import { sessionsService } from '../feathers.js';

function sessionMatches(session, sessionId) {
  if (!session || sessionId == null || sessionId === '') return false;
  return session.short_id === sessionId || String(session.id) === String(sessionId);
}

/**
 * Returns a single session by id or short_id. Updates in realtime (patched, removed).
 * Keeps the last loaded session while a new id is fetching so callers can avoid UI flicker.
 * `loading` is derived synchronously (requested id vs last completed fetch).
 */
export function useGetSession(sessionId) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null);

  useEffect(() => {
    if (!sessionId) {
      setError(null);
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
        setLoadedFor(sessionId);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setSession(null);
        setLoadedFor(sessionId);
      });

    const onPatched = (updated) => {
      const matches = updated.id === sessionId || updated.short_id === sessionId;
      if (!matches) return;
      setSession((prev) => (prev ? { ...prev, ...updated } : updated));
    };
    const onRemoved = (removed) => {
      const matches = removed.id === sessionId || removed.short_id === sessionId;
      if (!matches) return;
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

  const loading = Boolean(sessionId) && loadedFor !== sessionId;
  const matched = sessionMatches(session, sessionId);

  return { session: matched ? session : null, loading, error };
}
