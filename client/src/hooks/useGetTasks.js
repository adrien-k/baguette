import { useState, useEffect } from 'react';
import { tasksService } from '../feathers.js';

/**
 * Returns tasks, optionally filtered by sessionId. Updates in realtime.
 * If sessionId is set, only applies events when data.session_id === sessionId.
 */
export function useGetTasks({ sessionId = null, status = null, skip = false }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (skip) {
      setTasks([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const query = {};
    if (sessionId) query.session_id = sessionId;
    if (status != null) query.status = status;

    query['$sort'] = { created_at: -1 };

    tasksService
      .find({ query })
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        setTasks(list);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err);
          setTasks([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const merge = (data) => {
      if (sessionId != null && data.session_id !== sessionId) return;
      if (status != null && data.status !== status) return;

      setTasks((prev) => {
        if (prev.some((t) => t.id === data.id)) return prev;
        return [data, ...prev];
      });
    };
    const onCreated = merge;
    const onPatched = (data) => {
      if (sessionId != null && data.session_id !== sessionId) return;
      if (status != null && data.status !== status) return onRemoved(data);

      setTasks((prev) => prev.map((t) => (t.id === data.id ? { ...t, ...data } : t)));
    };

    const onRemoved = (data) => {
      if (sessionId != null && data.session_id !== sessionId) return;
      setTasks((prev) => prev.filter((t) => t.id !== data.id));
    };

    tasksService.on('created', onCreated);
    tasksService.on('patched', onPatched);
    tasksService.on('removed', onRemoved);

    return () => {
      cancelled = true;
      tasksService.off('created', onCreated);
      tasksService.off('patched', onPatched);
      tasksService.off('removed', onRemoved);
    };
  }, [sessionId, status, skip]);

  return { tasks, loading, error };
}
