import { describe, it, expect } from 'vitest';
import { logToolDisplayName, logToolCallSummary } from '../log-tool-label.js';

describe('logToolDisplayName', () => {
  it('formats Cursor mcp meta-tool with toolName', () => {
    expect(logToolDisplayName('mcp', { toolName: 'GitPush' })).toBe('MCP · GitPush');
  });

  it('formats baguette MCP prefix', () => {
    expect(logToolDisplayName('mcp__baguette__PrRead', {})).toBe('MCP · Baguette · PrRead');
  });

  it('returns the canonical name unchanged', () => {
    expect(logToolDisplayName('Bash', {})).toBe('Bash');
  });
});

describe('logToolCallSummary', () => {
  it('includes bash command', () => {
    expect(
      logToolCallSummary({
        name: 'Bash',
        kind: 'bash',
        args: { command: 'pnpm test' },
        status: 'completed',
      })
    ).toContain('pnpm test');
  });
});
