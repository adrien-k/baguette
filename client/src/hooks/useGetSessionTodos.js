import { useEffect } from 'react';
import { sortSessionTodosAsc } from '@baguette/shared/session-todo-sort.js';
import { sessionTodosService } from '../feathers.js';
import { findAllPages } from '../utils/feathersFindAll.js';
import { sameScopeId, scopeKeyOf } from '../utils/boundScope.js';
import { useScopedResource } from './useScopedResource.js';

const OPEN_TODO_STATUSES = new Set(['pending', 'in_progress']);
const EMPTY_TODOS = [];

export function useGetSessionTodos(sessionId, { enabled = true, openOnly = true } = {}) {
  const requestedKey = !enabled || sessionId == null ? '' : scopeKeyOf(sessionId, openOnly);
  const {
    data: todos,
    loading,
    reload,
    isKeyCurrent,
  } = useScopedResource(requestedKey, {
    empty: EMPTY_TODOS,
    enabled,
    load: async () => {
      try {
        const rows = sortSessionTodosAsc(
          await findAllPages(sessionTodosService, {
            session_id: sessionId,
            $sort: { sort_order: 1, ref: 1 },
          })
        );
        return openOnly ? rows.filter((row) => OPEN_TODO_STATUSES.has(row.status)) : rows;
      } catch {
        return EMPTY_TODOS;
      }
    },
  });

  useEffect(() => {
    if (!enabled || sessionId == null) return undefined;
    const key = requestedKey;
    const onCreated = (row) => {
      if (sameScopeId(row.session_id, sessionId) && isKeyCurrent(key)) reload();
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
  }, [enabled, sessionId, reload, requestedKey, isKeyCurrent]);

  return { todos, loading, reload };
}
