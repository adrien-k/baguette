import { useState, useEffect, useCallback } from 'react';
import { tasksService } from '../feathers.js';
import { useRefetchOnSseReconnect } from './useRefetchOnSseReconnect.js';
import {
  boundScopeLoading,
  boundScopeValue,
  rowsForSession,
  sameScopeId,
  scopeKeyOf,
} from '../utils/boundScope.js';
import { useScopeRequest } from './useScopeRequest.js';

/**
 * Returns tasks, optionally filtered by sessionId. Updates in realtime.
 * If sessionId is set, only applies events when data.session_id === sessionId.
 */
export function useGetTasks({ sessionId = null, status = null, skip = false }) {
  const requestedKey = skip ? '' : scopeKeyOf(sessionId == null ? 'all' : sessionId, status);
  const { begin, isKeyCurrent } = useScopeRequest(requestedKey);
  const [tasks, setTasks] = useState([]);
  const [loadedKey, setLoadedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(
    ({ silent = false } = {}) => {
      if (skip) return;
      const key = requestedKey;
      const isCurrent = begin(key);
      if (!silent) {
        setLoading(true);
        setLoadedKey('');
      }
      const query = {};
      if (sessionId) query.session_id = sessionId;
      if (status != null) query.status = status;
      query['$sort'] = { created_at: -1 };

      tasksService
        .find({ query })
        .then((res) => {
          if (!isCurrent()) return;
          const list = Array.isArray(res) ? res : (res?.data ?? []);
          setTasks(list);
          setLoadedKey(key);
          setError(null);
        })
        .catch((err) => {
          if (!isCurrent()) return;
          if (!silent) {
            setError(err);
            setTasks([]);
            setLoadedKey(key);
          }
        })
        .finally(() => {
          if (!silent && isCurrent()) setLoading(false);
        });
    },
    [sessionId, status, skip, requestedKey, begin]
  );

  useRefetchOnSseReconnect(refetch, !skip);

  useEffect(() => {
    let cancelled = false;
    if (skip) {
      begin('');
      setTasks([]);
      setLoading(false);
      setLoadedKey('');
      return;
    }

    const key = requestedKey;
    const isCurrent = begin(key);
    setLoading(true);
    setLoadedKey('');
    const query = {};
    if (sessionId) query.session_id = sessionId;
    if (status != null) query.status = status;

    query['$sort'] = { created_at: -1 };

    tasksService
      .find({ query })
      .then((res) => {
        if (cancelled || !isCurrent()) return;
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        setTasks(list);
        setLoadedKey(key);
        setError(null);
      })
      .catch((err) => {
        if (cancelled || !isCurrent()) return;
        setError(err);
        setTasks([]);
        setLoadedKey(key);
      })
      .finally(() => {
        if (!cancelled && isCurrent()) setLoading(false);
      });

    const merge = (data) => {
      if (sessionId != null && !sameScopeId(data.session_id, sessionId)) return;
      if (status != null && data.status !== status) return;
      if (!isKeyCurrent(key)) return;

      setTasks((prev) => {
        if (prev.some((t) => t.id === data.id)) return prev;
        return [data, ...prev];
      });
    };
    const onCreated = merge;
    const onRemoved = (data) => {
      if (sessionId != null && !sameScopeId(data.session_id, sessionId)) return;
      if (!isKeyCurrent(key)) return;
      setTasks((prev) => prev.filter((t) => t.id !== data.id));
    };
    const onPatched = (data) => {
      if (sessionId != null && !sameScopeId(data.session_id, sessionId)) return;
      if (!isKeyCurrent(key)) return;
      if (status != null && data.status !== status) return onRemoved(data);

      setTasks((prev) => prev.map((t) => (t.id === data.id ? { ...t, ...data } : t)));
    };

    tasksService.on('created', onCreated);
    tasksService.on('patched', onPatched);
    tasksService.on('removed', onRemoved);

    return () => {
      cancelled = true;
      tasksService.off('created', onCreated);
      tasksService.off('patched', onPatched);
      tasksService.off('removed', onRemoved);
    };
  }, [sessionId, status, skip, requestedKey, begin, isKeyCurrent]);

  const scopedTasks =
    sessionId == null
      ? boundScopeValue(requestedKey, loadedKey, tasks, [])
      : boundScopeValue(requestedKey, loadedKey, rowsForSession(tasks, sessionId), []);

  return {
    tasks: scopedTasks,
    loading: boundScopeLoading(requestedKey, loadedKey, loading),
    error: loadedKey === requestedKey ? error : null,
  };
}
