import { describe, expect, it } from 'vitest';
import { formatCursorToolCallResult } from '../cursor-tool-call-result.js';

describe('formatCursorToolCallResult', () => {
  it('extracts message from status:error payloads', () => {
    const { content, isError } = formatCursorToolCallResult(
      { status: 'error', error: { message: 'MCP tool not found' } },
      { toolCallStatus: 'completed' }
    );
    expect(isError).toBe(true);
    expect(content).toBe('MCP tool not found');
  });

  it('marks error when tool_call status is error even without result body', () => {
    const { content, isError } = formatCursorToolCallResult(undefined, {
      toolCallStatus: 'error',
    });
    expect(isError).toBe(true);
    expect(content).toBe('Tool call failed');
  });

  it('detects error from nested result when tool_call completed successfully', () => {
    const { content, isError } = formatCursorToolCallResult({
      status: 'error',
      error: 'authentication required',
    });
    expect(isError).toBe(true);
    expect(content).toBe('authentication required');
  });

  it('unwraps MCP content text for baguette tool failures', () => {
    const inner = JSON.stringify({ ok: false, error: 'bad request' });
    const { content, isError } = formatCursorToolCallResult({
      status: 'success',
      value: { content: [{ type: 'text', text: inner }] },
    });
    expect(isError).toBe(false);
    expect(content).toBe(inner);
  });

  it('returns placeholder for empty result when error was flagged', () => {
    const { content, isError } = formatCursorToolCallResult('', { isErrorHint: true });
    expect(isError).toBe(true);
    expect(content).toBe('Tool call failed');
  });
});
