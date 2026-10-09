import { useCallback, useEffect, useState } from 'react';
import { sessionTodosService } from '../feathers.js';

const OPEN_TODO_STATUSES = new Set(['pending', 'in_progress']);

export function useGetSessionTodos(sessionId, { enabled = true } = {}) {
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!enabled || sessionId == null) {
      setTodos([]);
      return;
    }
    setLoading(true);
    sessionTodosService
      .find({
        query: { session_id: sessionId, $sort: { sort_order: 1, id: 1 }, $limit: 500 },
      })
      .then((res) => setTodos((res.data ?? []).filter((row) => OPEN_TODO_STATUSES.has(row.status))))
      .catch(() => setTodos([]))
      .finally(() => setLoading(false));
  }, [enabled, sessionId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!enabled || sessionId == null) return undefined;
    const onCreated = (row) => {
      if (row.session_id === sessionId) reload();
    };
    const onPatched = onCreated;
    const onRemoved = onCreated;
    sessionTodosService.on('created', onCreated);
    sessionTodosService.on('patched', onPatched);
    sessionTodosService.on('removed', onRemoved);
    return () => {
      sessionTodosService.off('created', onCreated);
      sessionTodosService.off('patched', onPatched);
      sessionTodosService.off('removed', onRemoved);
    };
  }, [enabled, sessionId, reload]);

  return { todos, loading, reload };
}
