import ToolUseBlock from './ToolUseBlock.jsx';
import { CHAT_COLUMN_CLASS } from '../ChatMessagesViewport.jsx';

/**
 * Running Bash and RunProjectCommand tool_use blocks pinned above the composer until they complete.
 */
export default function ChatRunningBashDock({ items, worktreePath, sessionId }) {
  if (!items?.length) return null;

  return (
    <div
      className={`shrink-0 flex flex-col gap-2 py-2 border-t border-line/60 ${CHAT_COLUMN_CLASS}`}
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
