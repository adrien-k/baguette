import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toastFeathersError } from '../utils/toastError.jsx';
import { tasksService } from '../feathers.js';
import { taskLogKeys } from '../queries/keys.js';
import { sameScopeId } from '../utils/boundScope.js';

/**
 * Streaming log output for one task. The initial snapshot is a query; live
 * `log` events append to the cached entry (streaming append, not an upsert,
 * so it stays in this hook rather than the cache bridge).
 */
export function useGetTaskLogs(taskId) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: taskLogKeys.task(taskId),
    queryFn: async () => {
      const res = await tasksService.logs(taskId);
      return res.logs ?? '';
    },
    enabled: taskId != null,
  });

  useEffect(() => {
    if (!taskId) return undefined;
    const onLog = (data) => {
      if (!sameScopeId(data.id, taskId)) return;
      queryClient.setQueryData(
        taskLogKeys.task(taskId),
        (prev) => (prev ?? '') + (data.data ?? '')
      );
    };
    tasksService.on('log', onLog);
    return () => tasksService.off('log', onLog);
  }, [taskId, queryClient]);

  useEffect(() => {
    if (query.error) toastFeathersError('Failed to load task logs', query.error);
  }, [query.error]);

  return {
    logs: taskId != null ? (query.data ?? '') : '',
    loading: taskId != null && query.isPending,
  };
}
