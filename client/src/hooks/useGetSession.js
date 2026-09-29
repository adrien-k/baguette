import { useState, useEffect, useRef, useCallback } from 'react';
import { sessionsService, sessionIssuesService, tasksService } from '../feathers.js';

function sessionMatches(session, sessionId) {
  if (!session || sessionId == null || sessionId === '') return false;
  return session.short_id === sessionId || String(session.id) === String(sessionId);
}

function mergeSessionPatch(prev, updated) {
  if (!prev) return updated;
  return {
    ...prev,
    ...updated,
    open_issues_count: updated.open_issues_count ?? prev.open_issues_count,
    running_tasks_count: updated.running_tasks_count ?? prev.running_tasks_count,
  };
}

function paginateTotal(res) {
  if (res == null) return 0;
  if (typeof res.total === 'number') return res.total;
  return Array.isArray(res) ? res.length : (res?.data?.length ?? 0);
}

/**
 * Returns a single session by short_id via getSessionByShortId (includes open_issues_count
 * and running_tasks_count). Updates in realtime (patched, removed, task/issue counts).
 */
export function useGetSession(shortId) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null);
  const sessionIdRef = useRef(null);

  const refreshCounts = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const [issuesRes, tasksRes] = await Promise.all([
        sessionIssuesService.find({
          query: { session_id: sessionId, status: 'opened', $limit: 0 },
        }),
        tasksService.find({
          query: { session_id: sessionId, status: 'running', $limit: 0 },
        }),
      ]);
      setSession((prev) => {
        if (!prev || prev.id !== sessionId) return prev;
        return {
          ...prev,
          open_issues_count: paginateTotal(issuesRes),
          running_tasks_count: paginateTotal(tasksRes),
        };
      });
    } catch {
      /* counts are non-critical */
    }
  }, []);

  useEffect(() => {
    sessionIdRef.current = session?.id ?? null;
  }, [session?.id]);

  useEffect(() => {
    if (!shortId) {
      setError(null);
      return;
    }
    let cancelled = false;

    sessionsService
      .getSessionByShortId({ short_id: shortId })
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        setError(null);
        setLoadedFor(shortId);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setSession(null);
        setLoadedFor(shortId);
      });

    const onPatched = (updated) => {
      const matches = updated.short_id === shortId || String(updated.id) === String(shortId);
      if (!matches) return;
      setSession((prev) => mergeSessionPatch(prev, updated));
    };
    const onRemoved = (removed) => {
      const matches = removed.short_id === shortId || String(removed.id) === String(shortId);
      if (!matches) return;
      if (removed.archived_at) {
        setSession((prev) => mergeSessionPatch(prev, removed));
      }
    };

    sessionsService.on('patched', onPatched);
    sessionsService.on('removed', onRemoved);

    return () => {
      cancelled = true;
      sessionsService.off('patched', onPatched);
      sessionsService.off('removed', onRemoved);
    };
  }, [shortId]);

  useEffect(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    const forThisSession = (row) => row?.session_id === sessionId;
    const onIssueChange = (row) => {
      if (!forThisSession(row)) return;
      void refreshCounts(sessionId);
    };
    const onTaskChange = (row) => {
      if (!forThisSession(row)) return;
      void refreshCounts(sessionId);
    };

    sessionIssuesService.on('created', onIssueChange);
    sessionIssuesService.on('patched', onIssueChange);
    sessionIssuesService.on('removed', onIssueChange);
    tasksService.on('created', onTaskChange);
    tasksService.on('patched', onTaskChange);
    tasksService.on('removed', onTaskChange);

    return () => {
      sessionIssuesService.off('created', onIssueChange);
      sessionIssuesService.off('patched', onIssueChange);
      sessionIssuesService.off('removed', onIssueChange);
      tasksService.off('created', onTaskChange);
      tasksService.off('patched', onTaskChange);
      tasksService.off('removed', onTaskChange);
    };
  }, [session?.id, refreshCounts]);

  const loading = Boolean(shortId) && loadedFor !== shortId;
  const matched = sessionMatches(session, shortId);

  return { session: matched ? session : null, loading, error };
}
