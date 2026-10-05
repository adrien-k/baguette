import ToolUseBlock from './ToolUseBlock.jsx';

/**
 * Running Bash and RunCommand tool_use blocks at the end of the chat thread until they complete.
 */
export default function ChatRunningBashDock({ items, worktreePath, sessionId }) {
  if (!items?.length) return null;

  return (
    <div
      className="flex flex-col gap-2 py-2 border-t border-line/60"
      role="status"
      aria-live="polite"
      aria-label="Running commands"
    >
      {items.map(({ id, block, startedAt }) => (
        <ToolUseBlock
          key={id}
          block={block}
          worktreePath={worktreePath}
          sessionId={sessionId}
          runningStartedAt={startedAt}
        />
      ))}
    </div>
  );
}
