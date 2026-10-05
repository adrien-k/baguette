import ClaudeToolUseBlock from './claude/ClaudeToolUseBlock.jsx';
import CursorToolUseBlock from './cursor/CursorToolUseBlock.jsx';

const CURSOR_NATIVE_TOOL_NAMES = new Set([
  'mcp',
  'shell',
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  'task',
  'delete',
  'updateTodos',
  'createPlan',
  'ls',
  'semSearch',
  'readLints',
]);

function useCursorRenderer(block, agentSdk) {
  if (agentSdk === 'cursor') return true;
  if (agentSdk === 'claude') return false;
  if (block.name?.startsWith('mcp__baguette__')) return false;
  if (block.name === 'TaskCreate' || block.name === 'TaskUpdate' || block.name === 'TaskList') {
    return false;
  }
  return CURSOR_NATIVE_TOOL_NAMES.has(block.name);
}

export default function ToolUseBlock({
  block,
  worktreePath,
  sessionId,
  userReplied,
  runningStartedAt,
  agentSdk,
}) {
  const Impl = useCursorRenderer(block, agentSdk) ? CursorToolUseBlock : ClaudeToolUseBlock;
  return (
    <Impl
      block={block}
      worktreePath={worktreePath}
      sessionId={sessionId}
      userReplied={userReplied}
      runningStartedAt={runningStartedAt}
    />
  );
}
