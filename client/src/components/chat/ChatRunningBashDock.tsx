import type { ToolCallView } from '@baguette/shared/session-messages.ts';
import ToolCallBlock from './ToolCallBlock.tsx';

export type RunningToolDockItem = {
  id: string | number;
  message: ToolCallView;
  startedAt?: string | null;
};

/** Running Bash, RunTask, and AwaitDetachedTask tool_call rows pinned above the composer until done. */
export default function ChatRunningBashDock({
  items,
  sessionPath,
  sessionId,
  agents,
  onSelectAgent,
  tasks,
  onSelectTask,
}: {
  items?: RunningToolDockItem[];
  sessionPath?: string | null;
  sessionId?: number | null;
  agents?: Array<{
    id: number;
    ref?: number;
    name?: string;
    agent_type?: string;
    status?: string;
  }>;
  onSelectAgent?: (agent: {
    id: number;
    ref?: number;
    name?: string;
    agent_type?: string;
    status?: string;
  }) => void;
  tasks?: Array<{
    id: number;
    label?: string | null;
    task_key?: string | null;
    status?: string;
    command?: string;
  }>;
  onSelectTask?: (taskId: number) => void;
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
          sessionPath={sessionPath}
          sessionId={sessionId ?? undefined}
          agents={agents}
          onSelectAgent={onSelectAgent}
          tasks={tasks}
          onSelectTask={onSelectTask}
        />
      ))}
    </div>
  );
}
