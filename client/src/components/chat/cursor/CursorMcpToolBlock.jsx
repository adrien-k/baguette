import BaguetteMcpToolBlock from '../claude/BaguetteMcpToolBlock.jsx';
import { formatCursorToolCallResult } from '@baguette/shared/cursor-tool-call-result.js';

/**
 * Cursor routes custom tool calls through its own `mcp` meta-tool.
 * Unwraps nested toolName + result and delegates to Baguette MCP rendering.
 */
export default function CursorMcpToolBlock({ block, sessionId, runningStartedAt }) {
  const toolName = block.input?.toolName ?? 'mcp';
  const toolArgs = block.input?.args ?? block.input ?? {};

  const hasResult = block.result !== undefined && block.result !== null;
  const { content: resultText, isError: isResultError } = hasResult
    ? formatCursorToolCallResult(block.result, {
        isErrorHint: block.isError ?? false,
      })
    : { content: '', isError: false };

  return (
    <BaguetteMcpToolBlock
      block={{
        id: block.id,
        name: `mcp__baguette__${toolName}`,
        input: toolArgs,
        ...(hasResult ? { result: resultText, isError: isResultError } : {}),
      }}
      sessionId={sessionId}
      runningStartedAt={runningStartedAt}
    />
  );
}
