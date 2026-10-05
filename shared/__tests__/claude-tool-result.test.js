import { describe, it, expect } from 'vitest';
import { formatClaudeToolResult } from '../claude-tool-result.js';
import { buildToolCallComplete, buildToolCallStart } from '../session-message-mappers.js';

describe('formatClaudeToolResult', () => {
  it('joins text blocks from tool_result content array', () => {
    const { content, isError } = formatClaudeToolResult([
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ]);
    expect(content).toBe('hello\n\nworld');
    expect(isError).toBe(false);
  });
});

describe('mcp tool result persistence', () => {
  it('stores MCP response text on completed tool_call rows', () => {
    const start = buildToolCallStart('id', 'mcp__baguette__CurrentSessionInfo', {
      tool: 'CurrentSessionInfo',
    });
    const done = buildToolCallComplete(start, {
      rawResult: [{ type: 'text', text: '{"ok":true}' }],
    });
    expect(done.result).toMatchObject({ status: 'ok', content: '{"ok":true}' });
  });
});
