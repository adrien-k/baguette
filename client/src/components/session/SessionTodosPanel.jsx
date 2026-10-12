import { useMemo } from 'react';
import { useGetSessionTodos } from '../../hooks/useGetSessionTodos.js';
import SessionTodoList from '../chat/SessionTodoList.tsx';

const OPEN_STATUSES = new Set(['pending', 'in_progress']);

export default function SessionTodosPanel({ sessionId, emptyMessage = 'No todos yet.' }) {
  const { todos, loading } = useGetSessionTodos(sessionId, {
    enabled: sessionId != null,
    openOnly: false,
  });

  const { openTodos, completedTodos } = useMemo(() => {
    const open = [];
    const completed = [];
    for (const row of todos) {
      if (OPEN_STATUSES.has(row.status)) open.push(row);
      else if (row.status === 'completed') completed.push(row);
    }
    return { openTodos: open, completedTodos: completed };
  }, [todos]);

  if (loading) {
    return <p className="text-sm text-faint">Loading…</p>;
  }
  if (openTodos.length === 0 && completedTodos.length === 0) {
    return <p className="text-sm text-faint">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-6">
      {openTodos.length > 0 && <SessionTodoList todos={openTodos} variant="detail" />}
      {completedTodos.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-faint uppercase tracking-wide mb-3">Completed</h3>
          <SessionTodoList todos={completedTodos} variant="detail" />
        </section>
      )}
    </div>
  );
}
