import { useState, useEffect, useRef, useCallback } from 'react';
import { agentsService, sessionsService, sessionIssuesService, tasksService } from '../feathers.js';
import { applyAgentPatchToSession } from '../utils/sessionAgents.js';
import { useRefetchOnSseReconnect } from './useRefetchOnSseReconnect.js';
import { sameScopeId, scopeKeyOf } from '../utils/boundScope.js';
import { useScopeRequest } from './useScopeRequest.js';

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
  const requestedId = normalizeId(sessionId);
  const requestedKey = requestedId == null ? '' : scopeKeyOf(requestedId);
  const { begin, isKeyCurrent } = useScopeRequest(requestedKey);
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
        if (!prev || !sameScopeId(prev.id, id)) return prev;
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
      const key = scopeKeyOf(id);
      const isCurrent = begin(key);
      sessionsService
        .get(id)
        .then((s) => {
          if (!isCurrent()) return;
          setSession(s);
          setError(null);
          setLoadedFor(id);
          void refreshCounts(s.id);
        })
        .catch((err) => {
          if (!isCurrent()) return;
          setError(err);
          setSession(null);
          setLoadedFor(id);
        });
    },
    [sessionId, refreshCounts, begin]
  );

  useRefetchOnSseReconnect(refetch, requestedId != null);

  useEffect(() => {
    const id = normalizeId(sessionId);
    if (!id) {
      begin('');
      setError(null);
      return;
    }
    const key = scopeKeyOf(id);
    const isCurrent = begin(key);
    let cancelled = false;

    sessionsService
      .get(id)
      .then((s) => {
        if (cancelled || !isCurrent()) return;
        setSession(s);
        setError(null);
        setLoadedFor(id);
        void refreshCounts(s.id);
      })
      .catch((err) => {
        if (cancelled || !isCurrent()) return;
        setError(err);
        setSession(null);
        setLoadedFor(id);
      });

    const onPatched = (updated) => {
      if (!sameScopeId(updated.id, id) || !isKeyCurrent(key)) return;
      setSession((prev) => mergeSessionPatch(prev, updated));
    };
    const onRemoved = (removed) => {
      if (!sameScopeId(removed.id, id) || !isKeyCurrent(key)) return;
      setSession(null);
      setLoadedFor(null);
    };

    const onAgentPatched = (agent) => {
      if (!sameScopeId(agent?.session_id, id) || !isKeyCurrent(key)) return;
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
  }, [sessionId, refreshCounts, begin, isKeyCurrent]);

  useEffect(() => {
    const currentId = sessionIdRef.current;
    if (!currentId) return;

    const forThisSession = (row) => sameScopeId(row?.session_id, currentId);
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

  const loading = Boolean(requestedId) && !sameScopeId(loadedFor, requestedId);
  const matched = Boolean(session) && requestedId != null && sameScopeId(session.id, requestedId);

  return {
    session: matched ? session : null,
    loading,
    error: sameScopeId(loadedFor, requestedId) ? error : null,
  };
}
