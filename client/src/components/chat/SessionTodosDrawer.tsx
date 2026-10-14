import { ChevronDown, ChevronUp, ListTodo } from 'lucide-react';
import SessionTodosPanel from '../session/SessionTodosPanel.jsx';
import type { SessionTodoCounts } from './SessionTodoCountCard.tsx';

function drawerSummary(counts: SessionTodoCounts): string {
  const parts = [];
  if (counts.open > 0) parts.push(`${counts.open} open`);
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} in progress`);
  if (counts.completed > 0) parts.push(`${counts.completed} completed`);
  return parts.join(' · ');
}

export default function SessionTodosDrawer({
  sessionId,
  counts,
  expanded,
  onExpandedChange,
}: {
  sessionId?: number | string | null;
  counts: SessionTodoCounts;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const total = counts.open + counts.inProgress + counts.completed;
  if (total <= 0 || sessionId == null) return null;

  const summary = drawerSummary(counts);

  return (
    <div className="w-full shrink-0 rounded-lg border border-strong bg-control overflow-hidden">
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-control-hover/40 transition-colors"
        aria-expanded={expanded}
      >
        <ListTodo className="w-3.5 h-3.5 shrink-0 text-accent/80" />
        <span className="text-xs font-medium text-secondary">Todos</span>
        <span className="text-xs text-faint truncate min-w-0 flex-1">{summary}</span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 shrink-0 text-faint" aria-hidden />
        ) : (
          <ChevronDown className="w-4 h-4 shrink-0 text-faint" aria-hidden />
        )}
      </button>
      {expanded && (
        <div
          className="px-3 pb-3 pt-2 border-t border-line/60 max-h-[min(40vh,18rem)] overflow-y-auto overscroll-contain"
          role="region"
          aria-label="Session todos"
        >
          <SessionTodosPanel sessionId={sessionId} emptyMessage="No todos." />
        </div>
      )}
    </div>
  );
}
