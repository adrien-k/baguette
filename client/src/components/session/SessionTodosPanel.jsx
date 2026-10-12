import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useGetSessionTodos } from '../../hooks/useGetSessionTodos.js';
import SessionTodoList from '../chat/SessionTodoList.tsx';

const OPEN_STATUSES = new Set(['pending', 'in_progress']);

const SECTION_HEADING_CLASS = 'text-xs font-medium text-faint uppercase tracking-wide';

export default function SessionTodosPanel({ sessionId, emptyMessage = 'No todos yet.' }) {
  const [completedExpanded, setCompletedExpanded] = useState(false);
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

  const showCompletedSection = completedTodos.length > 0;

  return (
    <div className="space-y-6">
      {openTodos.length > 0 && <SessionTodoList todos={openTodos} variant="detail" />}
      {showCompletedSection && (
        <section className={`space-y-4 ${openTodos.length > 0 ? 'border-t border-line pt-4' : ''}`}>
          <button
            type="button"
            onClick={() => setCompletedExpanded((prev) => !prev)}
            className={`${SECTION_HEADING_CLASS} flex w-full items-center gap-1.5 text-left hover:text-secondary`}
          >
            {completedExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            Completed ({completedTodos.length})
          </button>
          {completedExpanded && <SessionTodoList todos={completedTodos} variant="detail" />}
        </section>
      )}
    </div>
  );
}
