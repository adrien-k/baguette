import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tasksService } from '../feathers.js';
import { taskKeys } from '../queries/keys.js';
import { feathersFind } from '../queries/feathersFinders.js';

function tasksQueryFilter(sessionId, status) {
  const query = { $sort: { created_at: -1 } };
  if (sessionId != null) query.session_id = sessionId;
  if (status != null) query.status = status;
  return query;
}

/**
 * Returns tasks, optionally filtered by sessionId/status. Realtime updates
 * (created/patched/removed, incl. tasks leaving a status filter) are applied
 * to the query cache by the central `sseCacheBridge`. A reconnect reloads the
 * list from the server, then applies events that arrived during the reload.
 */
export function useGetTasks({ sessionId = null, status = null, skip = false } = {}) {
  const enabled = !skip;
  const filter = useMemo(
    () => ({ sessionId: sessionId ?? null, status: status ?? null }),
    [sessionId, status]
  );

  const query = useQuery({
    queryKey: taskKeys.list(filter),
    queryFn: () => feathersFind(tasksService, tasksQueryFilter(filter.sessionId, filter.status)),
    enabled,
  });

  return {
    tasks: enabled ? (query.data ?? []) : [],
    loading: enabled && query.isPending,
    error: enabled ? (query.error ?? null) : null,
  };
}
