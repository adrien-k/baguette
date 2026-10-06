import { ChevronDown, ChevronUp, Clock } from 'lucide-react';
import QueuedMessages from '../QueuedMessages.jsx';
import TiedLoopMessages from '../TiedLoopMessages.jsx';

function drawerSummary(
  queue: Record<string, unknown>[],
  tiedLoops: Record<string, unknown>[]
): string {
  const scheduled = queue.filter((q) => q.kind === 'scheduled').length;
  const queued = queue.length - scheduled;
  const parts = [];
  if (queued > 0) parts.push(`${queued} queued`);
  if (scheduled > 0) parts.push(`${scheduled} scheduled`);
  if (tiedLoops.length > 0) parts.push(`${tiedLoops.length} recurring`);
  return parts.join(' · ');
}

/**
 * Collapsible panel above the agent composer for queued, scheduled, and tied-loop messages.
 */
export default function QueuedScheduledDrawer({
  queue,
  tiedLoops,
  session,
  models,
  onDelete,
  onSendNow,
  onEdit,
  loopEditUrl,
  onTiedLoopDelete,
  expanded,
  onExpandedChange,
}: {
  queue: Record<string, unknown>[];
  tiedLoops: Record<string, unknown>[];
  session?: Record<string, unknown> | null;
  models?: { id?: string; label?: string; name?: string }[];
  onDelete?: (id: number) => unknown;
  onSendNow?: (id: number) => unknown;
  onEdit?: (id: number, messageJson: string) => unknown;
  loopEditUrl?: string;
  onTiedLoopDelete?: (id: number) => unknown;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const count = queue.length + tiedLoops.length;
  if (count === 0) return null;

  const summary = drawerSummary(queue, tiedLoops);

  return (
    <div className="w-full shrink-0 rounded-lg border border-strong bg-control overflow-hidden">
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-control-hover/40 transition-colors"
        aria-expanded={expanded}
      >
        <Clock className="w-3.5 h-3.5 shrink-0 text-accent/80" />
        <span className="text-xs font-medium text-secondary">Queued &amp; scheduled</span>
        <span className="text-xs text-faint truncate min-w-0 flex-1">{summary}</span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 shrink-0 text-faint" aria-hidden />
        ) : (
          <ChevronDown className="w-4 h-4 shrink-0 text-faint" aria-hidden />
        )}
      </button>
      {expanded && (
        <div
          className="flex flex-col gap-2 px-3 pb-3 pt-0 border-t border-line/60 max-h-[min(40vh,18rem)] overflow-y-auto overscroll-contain"
          role="region"
          aria-label="Queued and scheduled messages"
        >
          <QueuedMessages
            queue={queue}
            session={session}
            models={models}
            onDelete={onDelete}
            onSendNow={onSendNow}
            onEdit={onEdit}
          />
          <TiedLoopMessages loops={tiedLoops} editHref={loopEditUrl} onDelete={onTiedLoopDelete} />
        </div>
      )}
    </div>
  );
}
