import { useState, useEffect, useRef, useCallback } from 'react';
import { toastFeathersError } from '../utils/toastError.jsx';
import { messagesService } from '../feathers.js';
import { useRefetchOnSseReconnect } from './useRefetchOnSseReconnect.js';

const PAGE_SIZE = 50;

export function useGetReviewMessages(sessionId, { enabled = true } = {}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const oldestIdRef = useRef(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setLoading(false);
      setHasMore(false);
      oldestIdRef.current = null;
      return;
    }
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setHasMore(false);
    oldestIdRef.current = null;

    messagesService
      .find({
        query: {
          session_id: sessionId,
          agent_type: 'reviewer',
          $sort: { id: -1 },
          $limit: PAGE_SIZE,
        },
      })
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        const sorted = [...list].reverse();
        setMessages(sorted);
        setHasMore(list.length === PAGE_SIZE);
        oldestIdRef.current = sorted[0]?.id ?? null;
      })
      .catch((err) => {
        if (!cancelled) toastFeathersError('Failed to load review messages', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const onCreated = (message) => {
      if (message.session_id !== sessionId) return;
      if (message.agent_type !== 'reviewer') return;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    };
    const onPatched = (message) => {
      if (message.session_id !== sessionId) return;
      if (message.agent_type !== 'reviewer') return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    };
    const onRemoved = (message) => {
      if (message.session_id !== sessionId) return;
      if (message.agent_type !== 'reviewer') return;
      setMessages((prev) => prev.filter((m) => m.id !== message.id));
    };
    messagesService.on('created', onCreated);
    messagesService.on('patched', onPatched);
    messagesService.on('removed', onRemoved);
    return () => {
      cancelled = true;
      messagesService.off('created', onCreated);
      messagesService.off('patched', onPatched);
      messagesService.off('removed', onRemoved);
    };
  }, [sessionId, enabled]);

  const reload = useCallback(
    ({ silent = false } = {}) => {
      if (!sessionId) return;
      if (!silent) {
        setLoading(true);
        setMessages([]);
        setHasMore(false);
        oldestIdRef.current = null;
      }
      messagesService
        .find({
          query: {
            session_id: sessionId,
            agent_type: 'reviewer',
            $sort: { id: -1 },
            $limit: PAGE_SIZE,
          },
        })
        .then((res) => {
          const list = Array.isArray(res) ? res : (res?.data ?? []);
          const sorted = [...list].reverse();
          setMessages(sorted);
          setHasMore(list.length === PAGE_SIZE);
          oldestIdRef.current = sorted[0]?.id ?? null;
        })
        .catch((err) => {
          if (!silent) toastFeathersError('Failed to load review messages', err);
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [sessionId]
  );

  useRefetchOnSseReconnect(reload, Boolean(sessionId) && enabled);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || !oldestIdRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await messagesService.find({
        query: {
          session_id: sessionId,
          agent_type: 'reviewer',
          id: { $lt: oldestIdRef.current },
          $sort: { id: -1 },
          $limit: PAGE_SIZE,
        },
      });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      const older = [...list].reverse();
      if (older.length > 0) oldestIdRef.current = older[0].id;
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length === PAGE_SIZE);
    } catch (err) {
      toastFeathersError('Failed to load more review messages', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, sessionId]);

  return { messages, loading, loadingMore, hasMore, loadMore, reload };
}
