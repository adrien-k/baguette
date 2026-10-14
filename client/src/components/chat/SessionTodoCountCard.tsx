import { ListTodo } from 'lucide-react';

export type SessionTodoCounts = {
  open: number;
  inProgress: number;
  completed: number;
};

function CountPill({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  className: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${className}`}
    >
      <span className="opacity-80">{label}</span>
      {count}
    </span>
  );
}

export default function SessionTodoCountCard({
  counts,
  expanded,
  onClick,
}: {
  counts: SessionTodoCounts;
  expanded: boolean;
  onClick: () => void;
}) {
  const total = counts.open + counts.inProgress + counts.completed;
  if (total <= 0) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors max-w-full ${
        expanded
          ? 'border-brand/45 bg-brand/15 text-accent'
          : 'border-strong/80 bg-control/60 text-secondary hover:bg-control-hover/50'
      }`}
      aria-expanded={expanded}
      aria-label="Session todos"
    >
      <ListTodo className="w-3.5 h-3.5 shrink-0" aria-hidden />
      <span className="hidden sm:inline text-[10px] font-medium uppercase tracking-wide text-faint">
        Todos
      </span>
      <span className="flex flex-wrap items-center gap-1 min-w-0">
        <CountPill
          label="Open"
          count={counts.open}
          className="border-strong/80 bg-control/80 text-fg-muted"
        />
        <CountPill
          label="Active"
          count={counts.inProgress}
          className="border-brand/35 bg-brand/15 text-accent"
        />
        <CountPill
          label="Done"
          count={counts.completed}
          className="border-success/35 bg-success/15 text-success"
        />
      </span>
    </button>
  );
}
