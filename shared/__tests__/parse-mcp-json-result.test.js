import { describe, it, expect } from 'vitest';
import { ok } from '../../server/services/baguette-mcp-tool-result.js';
import {
  claudeBuildToolCallComplete,
  claudeBuildToolCallStart,
} from '../../server/agent-sdks/claude/mapping.ts';
import { parseMcpJsonResult } from '../parse-mcp-json-result.js';

describe('parseMcpJsonResult', () => {
  it('unwraps GitPush approval flags from ok() via claudeBuildToolCallComplete', () => {
    const start = claudeBuildToolCallStart('p1', 'mcp__baguette__GitPush', { tool: 'GitPush' });
    const done = claudeBuildToolCallComplete(start, {
      rawResult: ok({ approval_requested: true, request_id: 'req-1' }),
    });
    const parsed = parseMcpJsonResult(done.result);
    expect(parsed?.approval_requested).toBe(true);
    expect(parsed?.request_id).toBe('req-1');
  });

  it('unwraps MCP text content blocks', () => {
    const parsed = parseMcpJsonResult({
      content: [{ type: 'text', text: JSON.stringify({ ok: true, markdown: '# Plan' }) }],
    });
    expect(parsed?.markdown).toBe('# Plan');
  });
});
