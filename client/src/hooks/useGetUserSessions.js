import { useState, useEffect, useCallback, useRef } from 'react';
import { sessionsService } from '../feathers.js';
import { sortSessionsForList } from '@baguette/shared/session-sort.js';
import { sessionMatchesListQuery } from '@baguette/shared/session-list-query.js';

const PAGE_SIZE = 50;

function queryKey(query) {
  return JSON.stringify(query ?? {});
}

/**
 * Returns sessions for the current user, filtered on the server.
 * `listQuery` is sent on every page; only `$skip` / `$limit` change on load more.
 */
export function useGetUserSessions(listQuery = {}, { repos } = {}) {
  const [sessions, setSessions] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const skipRef = useRef(0);
  const listQueryRef = useRef(listQuery);
  listQueryRef.current = listQuery;
  const reposRef = useRef(repos);
  reposRef.current = repos;
  const listKey = queryKey(listQuery);

  const fetchPage = useCallback((skip, replace) => {
    const query = { $limit: PAGE_SIZE, $skip: skip, ...listQueryRef.current };
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
          return sortSessionsForList(merged);
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
  }, [refetch, listKey]);

  useEffect(() => {
    setSessions((prev) => {
      const filtered = prev.filter((s) =>
        sessionMatchesListQuery(s, listQueryRef.current, reposRef.current)
      );
      if (filtered.length === prev.length) return prev;
      return sortSessionsForList(filtered);
    });
  }, [repos]);

  useEffect(() => {
    const matches = (session) =>
      sessionMatchesListQuery(session, listQueryRef.current, reposRef.current);

    const mergeRealtime = (session) => {
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === session.id);
        if (!matches(session)) {
          if (!exists) return prev;
          skipRef.current = Math.max(0, skipRef.current - 1);
          return sortSessionsForList(prev.filter((s) => s.id !== session.id));
        }
        if (exists) {
          return sortSessionsForList(
            prev.map((s) => (s.id === session.id ? { ...s, ...session } : s))
          );
        }
        skipRef.current += 1;
        return sortSessionsForList([session, ...prev]);
      });
    };

    const onCreated = (session) => mergeRealtime(session);
    const onUpdated = (session) => mergeRealtime(session);
    const onPatched = (session) => mergeRealtime(session);
    const onRemoved = (session) => {
      if (!session?.archived_at) return;
      mergeRealtime(session);
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
  }, []);

  return { sessions, loading, error, refetch, hasMore, loadMore };
}
