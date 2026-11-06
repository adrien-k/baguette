import { useEffect } from 'react';
import { toastFeathersError } from '../utils/toastError.jsx';
import { tasksService } from '../feathers.js';
import { useRefetchOnSseReconnect } from './useRefetchOnSseReconnect.js';
import { sameScopeId, scopeKeyOf } from '../utils/boundScope.js';
import { useScopedResource } from './useScopedResource.js';

export function useGetTaskLogs(taskId) {
  const requestedKey = taskId == null ? '' : scopeKeyOf(taskId);
  const {
    data: logs,
    reload,
    patch,
    isKeyCurrent,
  } = useScopedResource(requestedKey, {
    empty: '',
    load: async () => {
      try {
        const res = await tasksService.logs(taskId);
        return res.logs ?? '';
      } catch (err) {
        toastFeathersError('Failed to load task logs', err);
        return '';
      }
    },
  });

  useRefetchOnSseReconnect(reload, Boolean(taskId));

  useEffect(() => {
    if (!taskId) return undefined;
    const key = requestedKey;
    const onLog = (data) => {
      if (!sameScopeId(data.id, taskId) || !isKeyCurrent(key)) return;
      patch((prev) => prev + (data.data ?? ''));
    };
    tasksService.on('log', onLog);
    return () => tasksService.off('log', onLog);
  }, [taskId, requestedKey, isKeyCurrent, patch]);

  return { logs };
}
