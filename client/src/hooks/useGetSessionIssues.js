import { useState, useEffect, useRef, useCallback } from 'react';
import { toastError } from '../utils/toastError.jsx';
import { sortIssuesBySeverity } from '@baguette/shared/session-issues.js';
import { sessionIssuesService } from '../feathers.js';
import { useRefetchOnSseReconnect } from './useRefetchOnSseReconnect.js';

export function useGetSessionIssues(sessionId, { enabled = true } = {}) {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const boundSessionIdRef = useRef(null);

  const refetch = useCallback(() => {
    if (!sessionId || !enabled) return;
    setLoading(true);
    sessionIssuesService
      .find({ query: { session_id: sessionId, $sort: { id: 1 }, $limit: 100 } })
      .then((res) => {
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        setIssues(sortIssuesBySeverity(list));
      })
      .catch((err) => toastError('Failed to load review issues', err))
      .finally(() => setLoading(false));
  }, [sessionId, enabled]);

  useRefetchOnSseReconnect(refetch, Boolean(sessionId) && enabled);

  useEffect(() => {
    if (!sessionId) {
      setIssues([]);
      setLoading(false);
      boundSessionIdRef.current = null;
      return;
    }

    if (boundSessionIdRef.current !== sessionId) {
      setIssues([]);
      boundSessionIdRef.current = sessionId;
    }

    let cancelled = false;

    if (enabled) {
      setLoading(true);
      sessionIssuesService
        .find({ query: { session_id: sessionId, $sort: { id: 1 }, $limit: 100 } })
        .then((res) => {
          if (cancelled) return;
          const list = Array.isArray(res) ? res : (res?.data ?? []);
          setIssues(sortIssuesBySeverity(list));
        })
        .catch((err) => {
          if (!cancelled) toastError('Failed to load review issues', err);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    const matches = (item) => item?.session_id === sessionId;
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
  }, [sessionId, enabled]);

  return { issues, loading };
}
