import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import ComposerTextarea from '../ComposerTextarea.jsx';
import CollapsibleMarkdown from '../chat/CollapsibleMarkdown.tsx';
import { SessionTodoStatusBadge } from '../chat/SessionTodoList.tsx';
import { sessionTodoHasBody, sessionTodoTitle } from '../../utils/sessionTodoDisplay.ts';
import { NEUTRAL_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';

const TODO_DETAIL_PREVIEW_LINES = 4;

const TODO_STATUSES = ['pending', 'in_progress', 'completed'];

const FIELD_CLASS =
  'w-full rounded-md border border-strong bg-control px-2.5 py-1.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/50';

const STATUS_SELECT_CLASS =
  'inline-flex h-7 shrink-0 rounded-md border border-strong bg-control px-2 text-xs text-heading capitalize focus:outline-none focus:ring-2 focus:ring-brand/50';

export default function SessionTodoCard({
  todo,
  readonly = false,
  busy = false,
  onSave,
  onDelete,
  onStatusChange,
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftStatus, setDraftStatus] = useState('pending');

  const startEdit = () => {
    setDraftTitle(todo.title?.trim() || sessionTodoTitle(todo));
    setDraftContent(todo.content?.trim() ?? '');
    setDraftStatus(todo.status ?? 'pending');
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const handleSave = async () => {
    const title = draftTitle.trim();
    const content = draftContent.trim();
    if (!title || !content || todo.id == null) return;
    const ok = await onSave(todo.id, { title, content, status: draftStatus });
    if (ok) setEditing(false);
  };

  const canSave = Boolean(draftTitle.trim() && draftContent.trim());

  if (editing) {
    return (
      <li
        id={todo.ref != null ? `todo-${todo.ref}` : undefined}
        className="rounded-lg border border-strong bg-inset/40 p-3 sm:p-4 space-y-3 scroll-mt-4"
      >
        <label className="block">
          <span className="text-[11px] text-faint mb-1 block">Title</span>
          <input
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            className={FIELD_CLASS}
            disabled={busy}
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-faint mb-1 block">Content</span>
          <ComposerTextarea
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            onSubmit={() => {
              void handleSave();
            }}
            canSubmit={canSave}
            disabled={busy}
            rows={4}
            maxLines={24}
            className={`${FIELD_CLASS} font-mono text-xs leading-relaxed resize-none`}
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-faint mb-1 block">Status</span>
          <select
            value={draftStatus}
            onChange={(e) => setDraftStatus(e.target.value)}
            className={STATUS_SELECT_CLASS}
            disabled={busy}
          >
            {TODO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || !canSave}
            className={PRIMARY_BUTTON_SIZED}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={busy}
            className={NEUTRAL_BUTTON_CLASS}
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li
      id={todo.ref != null ? `todo-${todo.ref}` : undefined}
      className={`rounded-lg border p-3 sm:p-4 space-y-2 scroll-mt-4 ${
        todo.status === 'completed'
          ? 'border-line bg-inset/20 opacity-90'
          : 'border-line bg-inset/30'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {readonly ? (
              <SessionTodoStatusBadge status={todo.status} />
            ) : (
              <select
                value={todo.status ?? 'pending'}
                onChange={(e) => onStatusChange(todo.id, e.target.value)}
                disabled={busy}
                className={STATUS_SELECT_CLASS}
                aria-label="Todo status"
              >
                {TODO_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            )}
            {todo.ref != null && (
              <span className="text-[11px] font-mono text-faint">#{todo.ref}</span>
            )}
          </div>
          <h3 className="text-sm font-medium text-heading">{sessionTodoTitle(todo)}</h3>
          {sessionTodoHasBody(todo) && (
            <div className="text-sm text-secondary">
              <CollapsibleMarkdown previewLines={TODO_DETAIL_PREVIEW_LINES} simpleToggle>
                {(todo.content ?? '').trim()}
              </CollapsibleMarkdown>
            </div>
          )}
        </div>
        {!readonly && (
          <div className="flex shrink-0 items-center gap-0.5 -mt-0.5">
            <button
              type="button"
              onClick={startEdit}
              disabled={busy}
              title="Edit todo"
              className="p-1.5 rounded-md text-faint hover:text-accent hover:bg-brand/10 transition-colors disabled:opacity-50"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(todo)}
              disabled={busy}
              title="Delete todo"
              className="p-1.5 rounded-md text-faint hover:text-danger hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
