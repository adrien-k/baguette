import { useState, useEffect, useRef, useCallback } from 'react';
import { toastError } from '../utils/toastError.jsx';
import { sessionReviewMessagesService } from '../feathers.js';

const PAGE_SIZE = 50;

export function useGetReviewMessages(sessionId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(!!sessionId);
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
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setHasMore(false);
    oldestIdRef.current = null;

    sessionReviewMessagesService
      .find({ query: { session_id: sessionId, $sort: { id: -1 }, $limit: PAGE_SIZE } })
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        const sorted = [...list].reverse();
        setMessages(sorted);
        setHasMore(list.length === PAGE_SIZE);
        oldestIdRef.current = sorted[0]?.id ?? null;
      })
      .catch((err) => {
        if (!cancelled) toastError('Failed to load review messages', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const onCreated = (message) => {
      if (message.session_id !== sessionId) return;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    };
    const onPatched = (message) => {
      if (message.session_id !== sessionId) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    };
    const onRemoved = (message) => {
      if (message.session_id !== sessionId) return;
      setMessages((prev) => prev.filter((m) => m.id !== message.id));
    };
    sessionReviewMessagesService.on('created', onCreated);
    sessionReviewMessagesService.on('patched', onPatched);
    sessionReviewMessagesService.on('removed', onRemoved);
    return () => {
      cancelled = true;
      sessionReviewMessagesService.off('created', onCreated);
      sessionReviewMessagesService.off('patched', onPatched);
      sessionReviewMessagesService.off('removed', onRemoved);
    };
  }, [sessionId]);

  const reload = useCallback(() => {
    if (!sessionId) return;
    setLoading(true);
    setMessages([]);
    setHasMore(false);
    oldestIdRef.current = null;
    sessionReviewMessagesService
      .find({ query: { session_id: sessionId, $sort: { id: -1 }, $limit: PAGE_SIZE } })
      .then((res) => {
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        const sorted = [...list].reverse();
        setMessages(sorted);
        setHasMore(list.length === PAGE_SIZE);
        oldestIdRef.current = sorted[0]?.id ?? null;
      })
      .catch((err) => toastError('Failed to load review messages', err))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || !oldestIdRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await sessionReviewMessagesService.find({
        query: {
          session_id: sessionId,
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
      toastError('Failed to load more review messages', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, sessionId]);

  return { messages, loading, loadingMore, hasMore, loadMore, reload };
}
