import { useState, useEffect, useRef, useCallback } from 'react';
import { toastError } from '../utils/toastError.jsx';
import { messagesService } from '../feathers.js';

const PAGE_SIZE = 50;

/**
 * Returns messages for a session with cursor-based pagination.
 * - Initial load: last 50 messages (newest first, then reversed for display)
 * - loadMore(): prepends the next 50 older messages
 * - Real-time created events always append to the tail
 */
export function useGetMessages(sessionId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);

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
    // Drop the previous session's messages immediately so they are never shown
    // under the newly selected session while its history is being fetched.
    setMessages([]);
    setHasMore(false);
    oldestIdRef.current = null;

    messagesService
      .find({ query: { session_id: sessionId, $sort: { id: -1 }, $limit: PAGE_SIZE } })
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        const sorted = [...list].reverse(); // oldest → newest for display
        setMessages(sorted);
        setHasMore(list.length === PAGE_SIZE);
        oldestIdRef.current = sorted[0]?.id ?? null;
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err);
          setMessages([]);
        }
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

    messagesService.on('created', onCreated);
    messagesService.on('patched', onPatched);

    return () => {
      cancelled = true;
      messagesService.off('created', onCreated);
      messagesService.off('patched', onPatched);
    };
  }, [sessionId]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || !oldestIdRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const res = await messagesService.find({
        query: {
          session_id: sessionId,
          id: { $lt: oldestIdRef.current },
          $sort: { id: -1 },
          $limit: PAGE_SIZE,
        },
      });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      const older = [...list].reverse(); // oldest → newest
      if (older.length > 0) {
        oldestIdRef.current = older[0].id;
      }
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length === PAGE_SIZE);
    } catch (err) {
      toastError('Failed to load more messages', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, sessionId]);

  return { messages, loading, loadingMore, hasMore, loadMore, error };
}
