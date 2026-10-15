import { useState, useEffect, useRef, useCallback } from 'react';
import { agentsService, sessionsService, sessionIssuesService, tasksService } from '../feathers.js';
import { applyAgentPatchToSession } from '../utils/sessionAgents.js';
import { useRefetchOnSseReconnect } from './useRefetchOnSseReconnect.js';

const normalizeId = (sessionId) =>
  sessionId == null || sessionId === '' || sessionId === 'new' ? null : sessionId;

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
 * Returns a single session by id (includes open_issues_count and running_tasks_count
 * fetched alongside the session). Updates in realtime (patched, removed, task/issue counts).
 */
export function useGetSession(sessionId) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null);
  const sessionIdRef = useRef(null);

  const refreshCounts = useCallback(async (id) => {
    if (!id) return;
    try {
      const [issuesRes, tasksRes] = await Promise.all([
        sessionIssuesService.find({
          query: { session_id: id, status: 'opened', $limit: 0 },
        }),
        tasksService.find({
          query: { session_id: id, status: 'running', $limit: 0 },
        }),
      ]);
      setSession((prev) => {
        if (!prev || prev.id !== id) return prev;
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

  const refetch = useCallback(
    (_opts) => {
      const id = normalizeId(sessionId);
      if (!id) return;
      sessionsService
        .get(id)
        .then((s) => {
          setSession(s);
          setError(null);
          setLoadedFor(id);
          void refreshCounts(s.id);
        })
        .catch((err) => {
          setError(err);
          setSession(null);
          setLoadedFor(id);
        });
    },
    [sessionId, refreshCounts]
  );

  useRefetchOnSseReconnect(refetch, normalizeId(sessionId) != null);

  useEffect(() => {
    const id = normalizeId(sessionId);
    if (!id) {
      setError(null);
      return;
    }
    let cancelled = false;

    sessionsService
      .get(id)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        setError(null);
        setLoadedFor(id);
        void refreshCounts(s.id);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setSession(null);
        setLoadedFor(id);
      });

    const onPatched = (updated) => {
      if (String(updated.id) !== String(id)) return;
      setSession((prev) => mergeSessionPatch(prev, updated));
    };
    const onRemoved = (removed) => {
      if (String(removed.id) !== String(id)) return;
      if (removed.archived_at) {
        setSession((prev) => mergeSessionPatch(prev, removed));
        return;
      }
      setSession(null);
      setLoadedFor(null);
    };

    const onAgentPatched = (agent) => {
      if (String(agent?.session_id) !== String(id)) return;
      setSession((prev) => applyAgentPatchToSession(prev, agent));
    };

    sessionsService.on('patched', onPatched);
    sessionsService.on('removed', onRemoved);
    agentsService.on('patched', onAgentPatched);

    return () => {
      cancelled = true;
      sessionsService.off('patched', onPatched);
      sessionsService.off('removed', onRemoved);
      agentsService.off('patched', onAgentPatched);
    };
  }, [sessionId, refreshCounts]);

  useEffect(() => {
    const currentId = sessionIdRef.current;
    if (!currentId) return;

    const forThisSession = (row) => String(row?.session_id) === String(currentId);
    const onIssueChange = (row) => {
      if (!forThisSession(row)) return;
      void refreshCounts(Number(currentId));
    };
    const onTaskChange = (row) => {
      if (!forThisSession(row)) return;
      void refreshCounts(Number(currentId));
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

  const loading = Boolean(normalizeId(sessionId)) && loadedFor !== normalizeId(sessionId);
  const requestedId = normalizeId(sessionId);
  const matched =
    Boolean(session) && requestedId != null && String(session.id) === String(requestedId);

  return { session: matched ? session : null, loading, error };
}
