import { useQuery } from '@tanstack/react-query';
import { sortSessionTodosAsc } from '@baguette/shared/session-todo-sort.js';
import { sessionTodosService } from '../feathers.js';
import { sessionTodoKeys } from '../queries/keys.js';
import { findAllPages } from '../utils/feathersFindAll.js';

const OPEN_TODO_STATUSES = new Set(['pending', 'in_progress']);
const EMPTY_TODOS = [];

/**
 * Todo rows for one session (all pages), optionally filtered to open items.
 * Todo SSE events invalidate the session's todo cache entries via the central
 * `sseCacheBridge`.
 */
export function useGetSessionTodos(sessionId, { enabled = true, openOnly = true } = {}) {
  const active = enabled && sessionId != null;

  const query = useQuery({
    queryKey: sessionTodoKeys.session(sessionId, openOnly),
    queryFn: async () => {
      const rows = sortSessionTodosAsc(
        await findAllPages(sessionTodosService, {
          session_id: sessionId,
          $sort: { sort_order: 1, ref: 1 },
        })
      );
      return openOnly ? rows.filter((row) => OPEN_TODO_STATUSES.has(row.status)) : rows;
    },
    enabled: active,
  });

  return {
    todos: active ? (query.data ?? EMPTY_TODOS) : EMPTY_TODOS,
    loading: active && query.isPending,
    reload: query.refetch,
  };
}
