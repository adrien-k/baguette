import { useState, useEffect, useCallback } from 'react';
import { toastFeathersError } from '../utils/toastError.jsx';
import { tasksService } from '../feathers.js';
import { useRefetchOnSseReconnect } from './useRefetchOnSseReconnect.js';

export function useGetTaskLogs(taskId) {
  const [logs, setLogs] = useState('');

  const refetch = useCallback(() => {
    if (!taskId) return;
    tasksService
      .logs(taskId)
      .then((res) => setLogs(res.logs ?? ''))
      .catch((err) => toastFeathersError('Failed to load task logs', err));
  }, [taskId]);

  useRefetchOnSseReconnect(refetch, Boolean(taskId));

  useEffect(() => {
    if (!taskId) return;

    tasksService
      .logs(taskId)
      .then((res) => setLogs(res.logs ?? ''))
      .catch((err) => toastFeathersError('Failed to load task logs', err));

    const onLog = (data) => {
      if (data.id !== taskId) return;
      setLogs((prev) => prev + (data.data ?? ''));
    };

    tasksService.on('log', onLog);
    return () => tasksService.off('log', onLog);
  }, [taskId]);

  return { logs };
}
