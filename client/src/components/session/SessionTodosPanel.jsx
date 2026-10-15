import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { sessionTodosService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { useGetSessionTodos } from '../../hooks/useGetSessionTodos.js';
import SessionTodoList from '../chat/SessionTodoList.tsx';
import SessionTodoCard from './SessionTodoCard.jsx';
import ComposerTextarea from '../ComposerTextarea.jsx';
import { NEUTRAL_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';

const OPEN_STATUSES = new Set(['pending', 'in_progress']);

const SECTION_HEADING_CLASS = 'text-xs font-medium text-faint uppercase tracking-wide';

const FIELD_CLASS =
  'w-full rounded-md border border-strong bg-control px-2.5 py-1.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/50';

function EditableTodoList({ todos, readonly, busyId, onSave, onDelete, onStatusChange }) {
  return (
    <ul className="space-y-4">
      {todos.map((todo) => (
        <SessionTodoCard
          key={todo.id ?? todo.ref}
          todo={todo}
          readonly={readonly}
          busy={busyId === todo.id}
          onSave={onSave}
          onDelete={onDelete}
          onStatusChange={onStatusChange}
        />
      ))}
    </ul>
  );
}

export default function SessionTodosPanel({
  sessionId,
  emptyMessage = 'No todos yet.',
  editable = false,
}) {
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);

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

  const handleSave = async (id, fields) => {
    setBusyId(id);
    try {
      await sessionTodosService.patch(id, fields);
      return true;
    } catch (err) {
      toastError('Failed to update todo', err);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const handleStatusChange = async (id, status) => {
    if (id == null) return;
    setBusyId(id);
    try {
      await sessionTodosService.patch(id, { status });
    } catch (err) {
      toastError('Failed to update todo status', err);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (todo) => {
    if (todo.id == null) return;
    const label = todo.ref != null ? `#${todo.ref}` : 'this todo';
    if (!window.confirm(`Delete todo ${label}?`)) return;
    setBusyId(todo.id);
    try {
      await sessionTodosService.remove(todo.id);
    } catch (err) {
      toastError('Failed to delete todo', err);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async () => {
    const title = newTitle.trim();
    const content = newContent.trim();
    if (!title || !content || sessionId == null) return;
    setCreating(true);
    try {
      await sessionTodosService.create({ session_id: sessionId, title, content });
      setNewTitle('');
      setNewContent('');
      setShowAddForm(false);
    } catch (err) {
      toastError('Failed to create todo', err);
    } finally {
      setCreating(false);
    }
  };

  const canCreate = Boolean(newTitle.trim() && newContent.trim());

  const listProps = editable
    ? {
        readonly: false,
        busyId,
        onSave: handleSave,
        onDelete: handleDelete,
        onStatusChange: handleStatusChange,
      }
    : null;

  const renderOpenList = () => {
    if (openTodos.length === 0) return null;
    if (editable && listProps) {
      return <EditableTodoList todos={openTodos} {...listProps} />;
    }
    return <SessionTodoList todos={openTodos} variant="detail" />;
  };

  const renderCompletedList = (showList) => {
    if (!showList || completedTodos.length === 0) return null;
    if (editable && listProps) {
      return <EditableTodoList todos={completedTodos} {...listProps} />;
    }
    return <SessionTodoList todos={completedTodos} variant="detail" />;
  };

  if (loading) {
    return <p className="text-sm text-faint">Loading…</p>;
  }

  const isEmpty = openTodos.length === 0 && completedTodos.length === 0;
  const showCompletedSection = completedTodos.length > 0;
  const allTodosCompleted = openTodos.length === 0 && completedTodos.length > 0;
  const showCompletedToggle = showCompletedSection && !allTodosCompleted;

  return (
    <div className="space-y-6">
      {editable && (
        <div className="space-y-3">
          {!showAddForm ? (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className={`${NEUTRAL_BUTTON_CLASS} gap-1.5`}
            >
              <Plus className="w-3.5 h-3.5" aria-hidden />
              Add todo
            </button>
          ) : (
            <div className="rounded-lg border border-strong bg-inset/40 p-3 sm:p-4 space-y-3">
              <p className="text-xs font-medium text-secondary">New todo</p>
              <label className="block">
                <span className="text-[11px] text-faint mb-1 block">Title</span>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className={FIELD_CLASS}
                  disabled={creating}
                  placeholder="Short summary"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-faint mb-1 block">Content</span>
                <ComposerTextarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  onSubmit={() => {
                    void handleCreate();
                  }}
                  canSubmit={canCreate}
                  disabled={creating}
                  rows={4}
                  maxLines={24}
                  className={`${FIELD_CLASS} font-mono text-xs leading-relaxed resize-none`}
                  placeholder="Concrete work item (markdown)"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={creating || !canCreate}
                  className={PRIMARY_BUTTON_SIZED}
                >
                  {creating ? 'Adding…' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewTitle('');
                    setNewContent('');
                  }}
                  disabled={creating}
                  className={NEUTRAL_BUTTON_CLASS}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isEmpty && !showAddForm && <p className="text-sm text-faint">{emptyMessage}</p>}

      {renderOpenList()}
      {allTodosCompleted && renderCompletedList(true)}
      {showCompletedToggle && (
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
          {renderCompletedList(completedExpanded)}
        </section>
      )}
    </div>
  );
}
