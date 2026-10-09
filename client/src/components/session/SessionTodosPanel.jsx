import { useGetSessionTodos } from '../../hooks/useGetSessionTodos.js';
import SessionTodoList from '../chat/SessionTodoList.tsx';

export default function SessionTodosPanel({ sessionId, emptyMessage = 'No open todos yet.' }) {
  const { todos, loading } = useGetSessionTodos(sessionId, {
    enabled: sessionId != null,
  });

  if (loading) {
    return <p className="text-sm text-faint">Loading…</p>;
  }
  if (todos.length === 0) {
    return <p className="text-sm text-faint">{emptyMessage}</p>;
  }
  return <SessionTodoList todos={todos} variant="detail" />;
}
