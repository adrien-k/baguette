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

function messageQueryBase(sessionId, agentId) {
  const query = { session_id: sessionId, $sort: { id: 1 }, $limit: PAGE_SIZE };
  if (agentId != null) {
    query.agent_id = agentId;
  }
  return query;
}

function findQueryFilter(sessionId, agentId) {
  if (agentId != null) {
    return { session_id: sessionId, agent_id: agentId };
  }
  return { session_id: sessionId };
}

async function pageMessagesAfter(sessionId, agentId, afterId, maxId = null) {
  const accumulated = [];
  let page;
  let cursor = afterId;
  do {
    const idFilter = maxId != null ? { $gt: cursor, $lte: maxId } : { $gt: cursor };
    const res = await messagesService.find({
      query: {
        ...messageQueryBase(sessionId, agentId),
        id: idFilter,
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
 * Returns messages for a session agent with cursor-based pagination.
 * @param {number|null} sessionId
 * @param {number|null} agentId - when set, load that agent's transcript
 * @param {{ skip?: boolean }} [options]
 */
export function useGetMessages(sessionId, agentId = null, options = {}) {
  const { skip = false } = options;
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
    if (!sessionId || initialLoadFailed || skip) return;
    const loaded = messagesRef.current;
    if (!loaded.length) return;

    const minId = Math.min(...loaded.map((m) => m.id));
    const maxId = Math.max(...loaded.map((m) => m.id));

    try {
      const inWindow = await pageMessagesAfter(sessionId, agentId, minId - 1, maxId);
      const newer = await pageMessagesAfter(sessionId, agentId, maxId, null);
      const fetched = [...inWindow, ...newer];
      setMessages((prev) => mergeSessionMessagesFromFetch(prev, fetched));
    } catch (err) {
      toastFeathersError('Failed to load new messages', err);
    }
  }, [sessionId, agentId, initialLoadFailed, skip]);

  const refetch = useCallback(
    ({ silent = false } = {}) => {
      if (!sessionId || initialLoadFailed || skip) return;
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
            ...findQueryFilter(sessionId, agentId),
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
    [sessionId, agentId, skip, initialLoadFailed, handleLoadError, syncMessagesOnReconnect]
  );

  useRefetchOnSseReconnect(refetch, Boolean(sessionId) && !skip && !initialLoadFailed);

  useEffect(() => {
    if (!sessionId || skip) {
      setMessages([]);
      setLoading(false);
      setHasMore(false);
      oldestIdRef.current = null;
      return;
    }

    let cancelled = false;
    setLoading(true);
    setInitialLoadFailed(false);
    setMessages([]);
    setHasMore(false);
    oldestIdRef.current = null;

    messagesService
      .find({
        query: {
          ...findQueryFilter(sessionId, agentId),
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
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) handleLoadError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const matchesScope = (message) => {
      if (message.session_id !== sessionId) return false;
      if (agentId != null) return message.agent_id === agentId;
      return true;
    };

    const onCreated = (message) => {
      if (!matchesScope(message)) return;
      setMessages((prev) => insertSessionMessageById(prev, message));
    };

    const onPatched = (message) => {
      if (!matchesScope(message)) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    };

    messagesService.on('created', onCreated);
    messagesService.on('patched', onPatched);

    return () => {
      cancelled = true;
      messagesService.off('created', onCreated);
      messagesService.off('patched', onPatched);
    };
  }, [sessionId, agentId, skip, handleLoadError]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || !oldestIdRef.current || skip) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const res = await messagesService.find({
        query: {
          ...findQueryFilter(sessionId, agentId),
          id: { $lt: oldestIdRef.current },
          $sort: { id: -1 },
          $limit: PAGE_SIZE,
        },
      });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      const older = [...list].reverse();
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
  }, [hasMore, sessionId, agentId, skip]);

  return { messages, loading, loadingMore, hasMore, loadMore, error };
}
