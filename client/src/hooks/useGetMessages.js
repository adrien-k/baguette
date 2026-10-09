import { useState, useEffect, useRef, useCallback } from 'react';
import { toastFeathersError } from '../utils/toastError.jsx';
import { messagesService } from '../feathers.js';
import { useRefetchOnSseReconnect } from './useRefetchOnSseReconnect.js';
import {
  insertSessionMessageById,
  mergeSessionMessagesFromFetch,
} from '../utils/sessionMessageOrder.js';

const PAGE_SIZE = 100;

function normalizeMessageList(res) {
  return Array.isArray(res) ? res : (res?.data ?? []);
}

/** Page builder messages with id > afterId, optionally capped at maxId. */
async function pageBuilderMessagesAfter(sessionId, afterId, maxId = null) {
  const accumulated = [];
  let page;
  let cursor = afterId;
  do {
    const idFilter = maxId != null ? { $gt: cursor, $lte: maxId } : { $gt: cursor };
    const res = await messagesService.find({
      query: {
        session_id: sessionId,
        agent_type: 'builder',
        id: idFilter,
        $sort: { id: 1 },
        $limit: PAGE_SIZE,
      },
    });
    page = normalizeMessageList(res);
    if (page.length === 0) break;
    accumulated.push(...page);
    cursor = page[page.length - 1].id;
  } while (page.length === PAGE_SIZE);
  return accumulated;
}

/**
 * Returns messages for a session with cursor-based pagination.
 * - Initial load: last 100 messages (newest first, then reversed for display)
 * - loadMore(): prepends the next 100 older messages
 * - Real-time created events insert by ascending id (out-of-order delivery stays sorted)
 * - SSE reconnect: reconcile patches in the loaded id window, then page in newer rows (no full reload)
 */
export function useGetMessages(sessionId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);

  const oldestIdRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const messagesRef = useRef([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const handleLoadError = useCallback((err) => {
    setError(err);
    setMessages([]);
    setHasMore(false);
    setInitialLoadFailed(true);
  }, []);

  const syncMessagesOnReconnect = useCallback(async () => {
    if (!sessionId || initialLoadFailed) return;
    const loaded = messagesRef.current;
    if (!loaded.length) return;

    const minId = Math.min(...loaded.map((m) => m.id));
    const maxId = Math.max(...loaded.map((m) => m.id));

    try {
      const inWindow = await pageBuilderMessagesAfter(sessionId, minId - 1, maxId);
      const newer = await pageBuilderMessagesAfter(sessionId, maxId);
      const fetched = [...inWindow, ...newer];
      setMessages((prev) => mergeSessionMessagesFromFetch(prev, fetched));
    } catch (err) {
      toastFeathersError('Failed to load new messages', err);
    }
  }, [sessionId, initialLoadFailed]);

  const refetch = useCallback(
    ({ silent = false } = {}) => {
      if (!sessionId || initialLoadFailed) return;
      if (silent) {
        syncMessagesOnReconnect();
        return;
      }

      setLoading(true);
      setMessages([]);
      setHasMore(false);
      oldestIdRef.current = null;

      messagesService
        .find({
          query: {
            session_id: sessionId,
            agent_type: 'builder',
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
          setError(null);
        })
        .catch((err) => handleLoadError(err))
        .finally(() => setLoading(false));
    },
    [sessionId, initialLoadFailed, handleLoadError, syncMessagesOnReconnect]
  );

  useRefetchOnSseReconnect(refetch, Boolean(sessionId) && !initialLoadFailed);

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
    setInitialLoadFailed(false);
    // Drop the previous session's messages immediately so they are never shown
    // under the newly selected session while its history is being fetched.
    setMessages([]);
    setHasMore(false);
    oldestIdRef.current = null;

    messagesService
      .find({
        query: {
          session_id: sessionId,
          agent_type: 'builder',
          $sort: { id: -1 },
          $limit: PAGE_SIZE,
        },
      })
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
        if (!cancelled) handleLoadError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const onCreated = (message) => {
      if (message.session_id !== sessionId) return;
      if (message.agent_type === 'reviewer') return;
      setMessages((prev) => insertSessionMessageById(prev, message));
    };

    const onPatched = (message) => {
      if (message.session_id !== sessionId) return;
      if (message.agent_type === 'reviewer') return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    };

    messagesService.on('created', onCreated);
    messagesService.on('patched', onPatched);

    return () => {
      cancelled = true;
      messagesService.off('created', onCreated);
      messagesService.off('patched', onPatched);
    };
  }, [sessionId, handleLoadError]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || !oldestIdRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const res = await messagesService.find({
        query: {
          session_id: sessionId,
          agent_type: 'builder',
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
      setHasMore(false);
      toastFeathersError('Failed to load more messages', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, sessionId]);

  return { messages, loading, loadingMore, hasMore, loadMore, error };
}
