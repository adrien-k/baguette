import { useState, useEffect, useRef, useCallback } from 'react';
import { toastFeathersError } from '../utils/toastError.jsx';
import { messagesService } from '../feathers.js';
import { useRefetchOnSseReconnect } from './useRefetchOnSseReconnect.js';
import {
  insertSessionMessageById,
  mergeSessionMessagesFromFetch,
} from '../utils/sessionMessageOrder.js';
import {
  boundScopeLoading,
  boundScopeValue,
  sameScopeId,
  scopeKeyOf,
} from '../utils/boundScope.js';
import { useScopeRequest } from './useScopeRequest.js';

const PAGE_SIZE = 100;
const EMPTY_MESSAGES = [];

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
  const requestedKey = skip || sessionId == null ? '' : scopeKeyOf(sessionId, agentId);
  const { begin, isKeyCurrent } = useScopeRequest(requestedKey);
  const [messages, setMessages] = useState([]);
  const [loadedKey, setLoadedKey] = useState('');
  const [loading, setLoading] = useState(Boolean(requestedKey));
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);

  const oldestIdRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const messagesRef = useRef([]);
  const loadedKeyRef = useRef(loadedKey);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    loadedKeyRef.current = loadedKey;
  }, [loadedKey]);

  const handleLoadError = useCallback((err, key) => {
    setError(err);
    setMessages([]);
    setHasMore(false);
    setInitialLoadFailed(true);
    setLoadedKey(key);
  }, []);

  const syncMessagesOnReconnect = useCallback(async () => {
    if (!sessionId || initialLoadFailed || skip) return;
    const key = requestedKey;
    const loaded = messagesRef.current;
    if (!loaded.length || loadedKeyRef.current !== key) return;

    const minId = Math.min(...loaded.map((m) => m.id));
    const maxId = Math.max(...loaded.map((m) => m.id));

    try {
      const inWindow = await pageMessagesAfter(sessionId, agentId, minId - 1, maxId);
      const newer = await pageMessagesAfter(sessionId, agentId, maxId, null);
      if (!isKeyCurrent(key)) return;
      const fetched = [...inWindow, ...newer];
      setMessages((prev) => mergeSessionMessagesFromFetch(prev, fetched));
    } catch (err) {
      toastFeathersError('Failed to load new messages', err);
    }
  }, [sessionId, agentId, initialLoadFailed, skip, requestedKey, isKeyCurrent]);

  const refetch = useCallback(
    ({ silent = false } = {}) => {
      if (!sessionId || initialLoadFailed || skip) return;
      if (silent) {
        syncMessagesOnReconnect();
        return;
      }

      const key = requestedKey;
      const isCurrent = begin(key);
      setLoading(true);
      setMessages([]);
      setHasMore(false);
      setLoadedKey('');
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
          if (!isCurrent()) return;
          const list = Array.isArray(res) ? res : (res?.data ?? []);
          const sorted = [...list].reverse();
          setMessages(sorted);
          setHasMore(list.length === PAGE_SIZE);
          oldestIdRef.current = sorted[0]?.id ?? null;
          setLoadedKey(key);
          setError(null);
        })
        .catch((err) => {
          if (!isCurrent()) return;
          handleLoadError(err, key);
        })
        .finally(() => {
          if (isCurrent()) setLoading(false);
        });
    },
    [
      sessionId,
      agentId,
      skip,
      initialLoadFailed,
      handleLoadError,
      syncMessagesOnReconnect,
      requestedKey,
      begin,
    ]
  );

  useRefetchOnSseReconnect(refetch, Boolean(sessionId) && !skip && !initialLoadFailed);

  useEffect(() => {
    if (!sessionId || skip) {
      begin('');
      setMessages([]);
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      setHasMore(false);
      setLoadedKey('');
      oldestIdRef.current = null;
      return;
    }

    const key = requestedKey;
    const isCurrent = begin(key);
    let cancelled = false;
    setLoading(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setInitialLoadFailed(false);
    setMessages([]);
    setHasMore(false);
    setLoadedKey('');
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
        if (cancelled || !isCurrent()) return;
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        const sorted = [...list].reverse();
        setMessages(sorted);
        setHasMore(list.length === PAGE_SIZE);
        oldestIdRef.current = sorted[0]?.id ?? null;
        setLoadedKey(key);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled && isCurrent()) handleLoadError(err, key);
      })
      .finally(() => {
        if (!cancelled && isCurrent()) setLoading(false);
      });

    const matchesScope = (message) => {
      if (!sameScopeId(message.session_id, sessionId)) return false;
      if (agentId != null) return sameScopeId(message.agent_id, agentId);
      return true;
    };

    const onCreated = (message) => {
      if (!matchesScope(message) || !isKeyCurrent(key)) return;
      setMessages((prev) => insertSessionMessageById(prev, message));
    };

    const onPatched = (message) => {
      if (!matchesScope(message) || !isKeyCurrent(key)) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === message.id);
        if (idx === -1) return insertSessionMessageById(prev, message);
        if (prev[idx] === message) return prev;
        const next = [...prev];
        next[idx] = message;
        return next;
      });
    };

    messagesService.on('created', onCreated);
    messagesService.on('patched', onPatched);

    return () => {
      cancelled = true;
      messagesService.off('created', onCreated);
      messagesService.off('patched', onPatched);
    };
  }, [sessionId, agentId, skip, handleLoadError, requestedKey, begin, isKeyCurrent]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || !oldestIdRef.current || skip) return;
    const key = requestedKey;
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
      if (!isKeyCurrent(key)) return;
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      const older = [...list].reverse();
      if (older.length > 0) {
        oldestIdRef.current = older[0].id;
      }
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length === PAGE_SIZE);
    } catch (err) {
      if (isKeyCurrent(key)) {
        setHasMore(false);
        toastFeathersError('Failed to load more messages', err);
      }
    } finally {
      loadingMoreRef.current = false;
      if (isKeyCurrent(key)) setLoadingMore(false);
    }
  }, [hasMore, sessionId, agentId, skip, requestedKey, isKeyCurrent]);

  // Scope key + handler guards already drop other sessions; do not re-filter
  // here — a new array every render would force the transcript to redraw.
  const scopedMessages = boundScopeValue(requestedKey, loadedKey, messages, EMPTY_MESSAGES);

  return {
    messages: scopedMessages,
    loading: boundScopeLoading(requestedKey, loadedKey, loading),
    loadingMore: loadedKey === requestedKey && loadingMore,
    hasMore: loadedKey === requestedKey && hasMore,
    loadMore,
    error: loadedKey === requestedKey ? error : null,
  };
}
