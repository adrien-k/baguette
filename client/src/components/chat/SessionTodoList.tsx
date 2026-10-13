import { CheckSquare2, Loader2, Square } from 'lucide-react';
import MarkdownContent from '../MarkdownContent.jsx';
import CollapsibleMarkdown from './CollapsibleMarkdown.tsx';

/** Collapsed preview length for todo bodies on the Plan tab. */
const TODO_DETAIL_PREVIEW_LINES = 4;

export type SessionTodoItem = {
  id?: number;
  ref?: number;
  content?: string;
  status?: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Open',
  in_progress: 'In progress',
  completed: 'Completed',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending: 'bg-control/80 text-fg-muted border-strong/80',
  in_progress: 'bg-brand/15 text-accent border-brand/35',
  completed: 'bg-success/15 text-success border-success/35',
};

export function SessionTodoStatusBadge({ status = 'pending' }: { status?: string }) {
  const key = status in STATUS_LABEL ? status : 'pending';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_BADGE_CLASS[key] ?? STATUS_BADGE_CLASS.pending}`}
    >
      {STATUS_LABEL[key]}
    </span>
  );
}

function SessionTodoIcon({ status }: { status?: string }) {
  if (status === 'in_progress') {
    return <Loader2 className="w-3.5 h-3.5 shrink-0 text-accent animate-spin" />;
  }
  if (status === 'completed') {
    return <CheckSquare2 className="w-3.5 h-3.5 shrink-0 text-success" />;
  }
  return <Square className="w-3.5 h-3.5 shrink-0 text-faint" />;
}

export function SessionTodoMarkdown({
  content,
  className = 'text-sm text-secondary',
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <MarkdownContent>{content}</MarkdownContent>
    </div>
  );
}

export default function SessionTodoList({
  todos,
  variant = 'compact',
}: {
  todos?: unknown;
  variant?: 'compact' | 'detail';
}) {
  const list = (Array.isArray(todos) ? todos : []).filter(
    (todo) =>
      typeof (todo as SessionTodoItem).content === 'string' &&
      (todo as SessionTodoItem).content!.trim()
  ) as SessionTodoItem[];

  if (list.length === 0) return null;

  if (variant === 'detail') {
    return (
      <ul className="space-y-4">
        {list.map((todo, i) => (
          <li
            key={todo.ref ?? i}
            id={todo.ref != null ? `todo-${todo.ref}` : undefined}
            className="rounded-lg border border-line bg-inset/30 p-3 sm:p-4 space-y-2 scroll-mt-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <SessionTodoIcon status={todo.status} />
              <SessionTodoStatusBadge status={todo.status} />
              {todo.ref != null && (
                <span className="text-[11px] font-mono text-faint">#{todo.ref}</span>
              )}
            </div>
            <div className="text-sm text-secondary">
              <CollapsibleMarkdown previewLines={TODO_DETAIL_PREVIEW_LINES} simpleToggle>
                {todo.content!.trim()}
              </CollapsibleMarkdown>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="py-0.5 pl-1 space-y-2">
      {list.map((todo, i) => (
        <div key={todo.id ?? i} className="flex items-start gap-2 text-xs">
          <SessionTodoIcon status={todo.status} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <SessionTodoStatusBadge status={todo.status} />
            </div>
            <SessionTodoMarkdown
              content={todo.content!.trim()}
              className="text-xs text-secondary"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
