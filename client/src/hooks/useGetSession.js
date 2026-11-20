import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sessionsService, sessionIssuesService, tasksService } from '../feathers.js';
import { REVIEW_TAB_ISSUE_STATUSES } from '@baguette/shared/session-issues.js';
import { sessionKeys } from '../queries/keys.js';
import { feathersGet } from '../queries/feathersFinders.js';
import { sameScopeId } from '../utils/boundScope.js';

const normalizeId = (sessionId) =>
  sessionId == null || sessionId === '' || sessionId === 'new' ? null : sessionId;

function paginateTotal(res) {
  if (res == null) return 0;
  if (typeof res.total === 'number') return res.total;
  return Array.isArray(res) ? res.length : (res?.data?.length ?? 0);
}

/** Live counts overlay (`$limit: 0` totals); refreshed via bridge invalidation. */
async function fetchSessionCounts(id) {
  const [issuesRes, tasksRes] = await Promise.all([
    sessionIssuesService.find({
      query: {
        session_id: id,
        $or: REVIEW_TAB_ISSUE_STATUSES.map((status) => ({ status })),
        $limit: 0,
      },
    }),
    tasksService.find({
      query: { session_id: id, status: 'running', $limit: 0 },
    }),
  ]);
  return {
    open_issues_count: paginateTotal(issuesRes),
    running_tasks_count: paginateTotal(tasksRes),
  };
}

/**
 * Returns a single session by id (includes open_issues_count and
 * running_tasks_count). Realtime updates (session patches, agent patches,
 * issue/task count changes) are applied by the central `sseCacheBridge`.
 */
export function useGetSession(sessionId) {
  const id = normalizeId(sessionId);

  const sessionQuery = useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => feathersGet(sessionsService, id),
    enabled: id != null,
  });

  const countsQuery = useQuery({
    queryKey: sessionKeys.counts(id),
    queryFn: () => fetchSessionCounts(id),
    enabled: id != null,
  });

  const session = useMemo(() => {
    const base = id != null && sameScopeId(sessionQuery.data?.id, id) ? sessionQuery.data : null;
    if (!base) return null;
    // Overlay live counts only when they are fresher than the session fetch —
    // the `get(id)` payload also carries counts, and the older of the two wins.
    const countsFresher = countsQuery.dataUpdatedAt > sessionQuery.dataUpdatedAt;
    return countsFresher && countsQuery.data ? { ...base, ...countsQuery.data } : base;
  }, [
    id,
    sessionQuery.data,
    sessionQuery.dataUpdatedAt,
    countsQuery.data,
    countsQuery.dataUpdatedAt,
  ]);

  return {
    session,
    loading: id != null && sessionQuery.isPending && !sessionQuery.error,
    error: sessionQuery.error ?? null,
  };
}
