import { describe, expect, it } from 'vitest';
import { isFileMutatingToolCall, isTerminalToolCall } from '../file-mutating-tools.js';

describe('file-mutating-tools', () => {
  it('detects typed edit/write tool rows', () => {
    expect(isFileMutatingToolCall({ type: 'tool_call', kind: 'edit' })).toBe(true);
    expect(isFileMutatingToolCall({ type: 'tool_call', kind: 'write' })).toBe(true);
    expect(isFileMutatingToolCall({ type: 'tool_call', kind: 'bash' })).toBe(false);
  });

  it('detects SDK tool names', () => {
    expect(isFileMutatingToolCall({ type: 'tool_call', name: 'Write' })).toBe(true);
    expect(isFileMutatingToolCall({ type: 'tool_call', name: 'Create' })).toBe(true);
  });

  it('treats running tools as non-terminal', () => {
    expect(isTerminalToolCall({ tool_status: 'running' })).toBe(false);
    expect(isTerminalToolCall({ tool_status: 'completed' })).toBe(true);
  });
});
