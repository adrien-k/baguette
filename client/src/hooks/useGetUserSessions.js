import { useState, useEffect, useCallback, useRef } from 'react';
import { sessionsService } from '../feathers.js';

const PAGE_SIZE = 50;

function sessionGroup(s) {
  if (s.archived_at) return 2;
  if (s.pr_status === 'merged') return 1;
  return 0;
}

function sortSessions(sessions) {
  return [...sessions].sort((a, b) => {
    const gd = sessionGroup(a) - sessionGroup(b);
    if (gd !== 0) return gd;
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

/**
 * Returns all sessions for the current user (server filters by auth).
 * Sessions are grouped: active → merged → archived, then by created_at desc.
 * Supports pagination via loadMore().
 */
export function useGetUserSessions() {
  const [sessions, setSessions] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const skipRef = useRef(0);

  const fetchPage = useCallback((skip, replace) => {
    const query = { $limit: PAGE_SIZE, $skip: skip };
    if (replace) {
      setLoading(true);
      setHasMore(false);
    }
    return sessionsService
      .find({ query })
      .then((res) => {
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        const serverTotal = Number(res?.total ?? list.length);
        const nextSkip = skip + list.length;
        skipRef.current = nextSkip;
        setHasMore(nextSkip < serverTotal && list.length > 0);
        if (!replace && list.length === 0) {
          setHasMore(false);
        }
        setSessions((prev) => {
          const merged = replace
            ? list
            : [...prev, ...list.filter((s) => !prev.some((p) => p.id === s.id))];
          return sortSessions(merged);
        });
        setError(null);
      })
      .catch((err) => {
        setError(err);
        if (replace) setSessions([]);
      })
      .finally(() => {
        if (replace) setLoading(false);
      });
  }, []);

  const refetch = useCallback(() => {
    skipRef.current = 0;
    fetchPage(0, true);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (!hasMore) return;
    fetchPage(skipRef.current, false);
  }, [fetchPage, hasMore]);

  useEffect(() => {
    refetch();

    const onCreated = (session) => {
      setSessions((prev) => {
        if (prev.some((s) => s.id === session.id)) return prev;
        skipRef.current += 1;
        return sortSessions([session, ...prev]);
      });
    };
    const onUpdated = (session) => {
      setSessions((prev) =>
        sortSessions(prev.map((s) => (s.id === session.id ? { ...s, ...session } : s)))
      );
    };
    const onPatched = (session) => {
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === session.id);
        if (exists)
          return sortSessions(prev.map((s) => (s.id === session.id ? { ...s, ...session } : s)));
        // Session may not be loaded yet (e.g., archive event for paginated session)
        return prev;
      });
    };
    const onRemoved = (session) => {
      // Backend emits 'patched' after archiving; this is a fallback to mark archived locally
      setSessions((prev) =>
        sortSessions(
          prev.map((s) =>
            s.id === session.id ? { ...s, archived_at: new Date().toISOString() } : s
          )
        )
      );
    };

    sessionsService.on('created', onCreated);
    sessionsService.on('updated', onUpdated);
    sessionsService.on('patched', onPatched);
    sessionsService.on('removed', onRemoved);

    return () => {
      sessionsService.off('created', onCreated);
      sessionsService.off('updated', onUpdated);
      sessionsService.off('patched', onPatched);
      sessionsService.off('removed', onRemoved);
    };
  }, [refetch]);

  return { sessions, loading, error, refetch, hasMore, loadMore };
}
