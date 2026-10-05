import { CheckSquare2, ListTodo, Loader2, Square } from 'lucide-react';

const STATUS_ICON = {
  completed: CheckSquare2,
  in_progress: Loader2,
  pending: Square,
  cancelled: Square,
};

function statusClass(status) {
  if (status === 'completed') return 'text-faint';
  if (status === 'in_progress') return 'text-secondary';
  return 'text-faint';
}

/**
 * Claude Agent SDK TaskCreate / TaskUpdate — same visual language as Cursor todo rows.
 */
export default function ClaudeTaskToolBlock({ block }) {
  const tool = block.name;
  const subject = block.input?.subject;
  const description = block.input?.description;
  const activeForm = block.input?.activeForm;
  const taskId = block.input?.taskId;
  const status = block.input?.status;

  if (tool === 'TaskCreate') {
    const title = subject || activeForm || 'Task';
    return (
      <div className="flex items-start gap-1.5 text-xs py-0.5 pl-1 text-secondary">
        <ListTodo className="w-3.5 h-3.5 shrink-0 text-faint mt-0.5" />
        <div className="min-w-0">
          <div className="font-medium">{title}</div>
          {description && description !== title && (
            <div className="text-faint mt-0.5">{description}</div>
          )}
        </div>
      </div>
    );
  }

  if (tool === 'TaskUpdate') {
    const Icon = STATUS_ICON[status] ?? Square;
    const spinning = status === 'in_progress';
    const label =
      subject ||
      activeForm ||
      (taskId != null ? `Task ${taskId}` : 'Task') +
        (status ? ` — ${status.replace(/_/g, ' ')}` : '');
    return (
      <div className={`flex items-center gap-1.5 text-xs py-0.5 pl-1 ${statusClass(status)}`}>
        <Icon
          className={`w-3 h-3 shrink-0 ${status === 'completed' ? 'text-success' : spinning ? 'text-accent animate-spin' : 'text-faint'}`}
        />
        <span className={status === 'completed' ? 'line-through' : ''}>{label}</span>
        {description && !label.includes(description) && (
          <span className="text-faint truncate">— {description}</span>
        )}
      </div>
    );
  }

  return (
    <div className="text-xs font-mono py-0.5 pl-1 text-faint">
      ↳ {tool}
      {subject ? `: ${subject}` : ''}
    </div>
  );
}
