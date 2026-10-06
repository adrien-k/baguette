import type { ToolCallView } from '@baguette/shared/session-messages.ts';
import ToolCallBlock from './ToolCallBlock.tsx';

export type RunningToolDockItem = {
  id: string | number;
  message: ToolCallView;
  startedAt?: string | null;
};

/** Running Bash and RunProjectCommand tool_call rows pinned above the composer until done. */
export default function ChatRunningBashDock({
  items,
  worktreePath,
  sessionId,
}: {
  items?: RunningToolDockItem[];
  worktreePath?: string | null;
  sessionId?: number | null;
}) {
  if (!items?.length) return null;

  return (
    <div
      className="flex flex-col gap-2 py-2 border-t border-line/60"
      role="status"
      aria-live="polite"
      aria-label="Running commands"
    >
      {items.map(({ id, message }) => (
        <ToolCallBlock
          key={id}
          message={message}
          worktreePath={worktreePath}
          sessionId={sessionId ?? undefined}
        />
      ))}
    </div>
  );
}
