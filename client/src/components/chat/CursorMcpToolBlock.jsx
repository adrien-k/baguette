import ToolUseBlock from './ToolUseBlock.jsx';
import { formatCursorToolCallResult } from '@baguette/shared/cursor-tool-call-result.js';

/**
 * Cursor routes custom tool calls through its own `mcp` meta-tool.
 * This component unwraps the nested toolName + result and delegates
 * to ToolUseBlock as if it were an `mcp__baguette__<toolName>` call.
 */
export default function CursorMcpToolBlock({ block, worktreePath, sessionId, runningStartedAt }) {
  const toolName = block.input?.toolName ?? 'mcp';
  const toolArgs = block.input?.args ?? {};

  const hasResult = block.result !== undefined && block.result !== null;
  const { content: resultText, isError: isResultError } = hasResult
    ? formatCursorToolCallResult(block.result, {
        isErrorHint: block.isError ?? false,
      })
    : { content: '', isError: false };

  return (
    <ToolUseBlock
      block={{
        id: block.id,
        name: `mcp__baguette__${toolName}`,
        input: toolArgs,
        ...(hasResult ? { result: resultText, isError: isResultError } : {}),
      }}
      worktreePath={worktreePath}
      sessionId={sessionId}
      runningStartedAt={runningStartedAt}
    />
  );
}
