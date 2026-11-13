import { useState, useEffect, useCallback } from 'react';
import { toastFeathersError } from '../utils/toastError.jsx';
import { sortIssuesBySeverity } from '@baguette/shared/session-issues.js';
import { sessionIssuesService } from '../feathers.js';
import { useRefetchOnSseReconnect } from './useRefetchOnSseReconnect.js';
import {
  boundScopeLoading,
  boundScopeValue,
  rowsForSession,
  sameScopeId,
  scopeKeyOf,
} from '../utils/boundScope.js';
import { useScopeRequest } from './useScopeRequest.js';

export function useGetSessionIssues(sessionId, { enabled = true } = {}) {
  const requestedKey = !enabled || !sessionId ? '' : scopeKeyOf(sessionId);
  const { begin, isKeyCurrent } = useScopeRequest(requestedKey);
  const [issues, setIssues] = useState([]);
  const [loadedKey, setLoadedKey] = useState('');
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(
    ({ silent = false } = {}) => {
      if (!sessionId || !enabled) return;
      const key = requestedKey;
      const isCurrent = begin(key);
      if (!silent) {
        setLoading(true);
        setLoadedKey('');
      }
      sessionIssuesService
        .find({ query: { session_id: sessionId, $sort: { id: 1 }, $limit: 100 } })
        .then((res) => {
          if (!isCurrent()) return;
          const list = Array.isArray(res) ? res : (res?.data ?? []);
          setIssues(sortIssuesBySeverity(list));
          setLoadedKey(key);
        })
        .catch((err) => {
          if (!isCurrent()) return;
          if (!silent) toastFeathersError('Failed to load review issues', err);
          setLoadedKey(key);
        })
        .finally(() => {
          if (!silent && isCurrent()) setLoading(false);
        });
    },
    [sessionId, enabled, requestedKey, begin]
  );

  useRefetchOnSseReconnect(refetch, Boolean(sessionId) && enabled);

  useEffect(() => {
    if (!sessionId) {
      begin('');
      setIssues([]);
      setLoading(false);
      setLoadedKey('');
      return;
    }

    const key = requestedKey;
    let cancelled = false;

    if (enabled) {
      const isCurrent = begin(key);
      setLoading(true);
      setIssues([]);
      setLoadedKey('');
      sessionIssuesService
        .find({ query: { session_id: sessionId, $sort: { id: 1 }, $limit: 100 } })
        .then((res) => {
          if (cancelled || !isCurrent()) return;
          const list = Array.isArray(res) ? res : (res?.data ?? []);
          setIssues(sortIssuesBySeverity(list));
          setLoadedKey(key);
        })
        .catch((err) => {
          if (cancelled || !isCurrent()) return;
          toastFeathersError('Failed to load review issues', err);
          setLoadedKey(key);
        })
        .finally(() => {
          if (!cancelled && isCurrent()) setLoading(false);
        });
    }

    const matches = (item) => sameScopeId(item?.session_id, sessionId) && isKeyCurrent(key);
    const onCreated = (item) => {
      if (!matches(item)) return;
      setIssues((prev) =>
        sortIssuesBySeverity(prev.some((i) => i.id === item.id) ? prev : [...prev, item])
      );
    };
    const onPatched = (item) => {
      if (!matches(item)) return;
      if (item.status === 'closed') {
        setIssues((prev) => prev.filter((i) => i.id !== item.id));
        return;
      }
      setIssues((prev) => sortIssuesBySeverity(prev.map((i) => (i.id === item.id ? item : i))));
    };
    const onRemoved = (item) => {
      if (!matches(item)) return;
      setIssues((prev) => prev.filter((i) => i.id !== item.id));
    };

    sessionIssuesService.on('created', onCreated);
    sessionIssuesService.on('patched', onPatched);
    sessionIssuesService.on('removed', onRemoved);
    return () => {
      cancelled = true;
      sessionIssuesService.off('created', onCreated);
      sessionIssuesService.off('patched', onPatched);
      sessionIssuesService.off('removed', onRemoved);
    };
  }, [sessionId, enabled, requestedKey, begin, isKeyCurrent]);

  return {
    issues: boundScopeValue(requestedKey, loadedKey, rowsForSession(issues, sessionId), []),
    loading: boundScopeLoading(requestedKey, loadedKey, loading),
  };
}
