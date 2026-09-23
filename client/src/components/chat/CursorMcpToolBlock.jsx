import ToolUseBlock from './ToolUseBlock.jsx';
import { formatCursorToolCallResult } from '@baguette/shared/cursor-tool-call-result.js';

/**
 * Cursor routes custom tool calls through its own `mcp` meta-tool.
 * This component unwraps the nested toolName + result and delegates
 * to ToolUseBlock as if it were an `mcp__baguette__<toolName>` call.
 */
export default function CursorMcpToolBlock({ block, worktreePath, sessionId }) {
  const toolName = block.input?.toolName ?? 'mcp';
  const toolArgs = block.input?.args ?? {};

  const { content: resultText, isError: isResultError } = formatCursorToolCallResult(block.result, {
    isErrorHint: block.isError ?? false,
  });

  return (
    <ToolUseBlock
      block={{
        name: `mcp__baguette__${toolName}`,
        input: toolArgs,
        result: resultText,
        isError: isResultError,
      }}
      worktreePath={worktreePath}
      sessionId={sessionId}
    />
  );
}
