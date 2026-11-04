import { useCallback, useEffect, useMemo, useState } from 'react';
import { filterComposerSessionTodos } from '@baguette/shared/composer-session-todos.js';
import { sortSessionTodosAsc } from '@baguette/shared/session-todo-sort.js';
import { agentsService, sessionPlansService, sessionTodosService } from '../feathers.js';
import { findAllPages } from '../utils/feathersFindAll.js';

function loadSessionTodos(sessionId) {
  return findAllPages(sessionTodosService, {
    session_id: sessionId,
    $sort: { sort_order: 1, ref: 1 },
  });
}

function loadSessionPlans(sessionId) {
  return findAllPages(sessionPlansService, { session_id: sessionId });
}

export function useComposerSessionTodos(sessionId, activeAgent, { enabled = true } = {}) {
  const [allTodos, setAllTodos] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);

  const reloadTodos = useCallback(() => {
    if (!enabled || sessionId == null) {
      setAllTodos([]);
      return;
    }
    loadSessionTodos(sessionId)
      .then((rows) => setAllTodos(sortSessionTodosAsc(rows)))
      .catch(() => setAllTodos([]));
  }, [enabled, sessionId]);

  const reloadPlans = useCallback(() => {
    if (!enabled || sessionId == null) {
      setPlans([]);
      return;
    }
    loadSessionPlans(sessionId)
      .then((rows) => setPlans(rows))
      .catch(() => setPlans([]));
  }, [enabled, sessionId]);

  const reload = useCallback(() => {
    if (!enabled || sessionId == null) {
      setAllTodos([]);
      setPlans([]);
      return;
    }
    setLoading(true);
    Promise.all([loadSessionTodos(sessionId), loadSessionPlans(sessionId)])
      .then(([todoRows, planRows]) => {
        setAllTodos(sortSessionTodosAsc(todoRows));
        setPlans(planRows);
      })
      .catch(() => {
        setAllTodos([]);
        setPlans([]);
      })
      .finally(() => setLoading(false));
  }, [enabled, sessionId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!enabled || sessionId == null) return undefined;

    const onTodoChange = (row) => {
      if (row.session_id === sessionId) reloadTodos();
    };
    sessionTodosService.on('created', onTodoChange);
    sessionTodosService.on('patched', onTodoChange);
    sessionTodosService.on('removed', onTodoChange);

    const onPlanChange = (row) => {
      if (row.session_id === sessionId) reloadPlans();
    };
    sessionPlansService.on('created', onPlanChange);
    sessionPlansService.on('patched', onPlanChange);
    sessionPlansService.on('removed', onPlanChange);

    const onAgentChange = (row) => {
      if (row.session_id === sessionId) reloadPlans();
    };
    agentsService.on('patched', onAgentChange);

    return () => {
      sessionTodosService.off('created', onTodoChange);
      sessionTodosService.off('patched', onTodoChange);
      sessionTodosService.off('removed', onTodoChange);
      sessionPlansService.off('created', onPlanChange);
      sessionPlansService.off('patched', onPlanChange);
      sessionPlansService.off('removed', onPlanChange);
      agentsService.off('patched', onAgentChange);
    };
  }, [enabled, sessionId, reloadPlans, reloadTodos]);

  const todos = useMemo(
    () =>
      filterComposerSessionTodos(allTodos, {
        currentPlanId: activeAgent?.current_plan_id,
        plans,
      }),
    [activeAgent?.current_plan_id, allTodos, plans]
  );

  return { todos, loading, reload };
}
