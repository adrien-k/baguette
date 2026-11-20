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

  it('merges approval outcome on root content envelope (ToolCallBlock passes result.data)', () => {
    const inner = JSON.stringify({
      ok: true,
      approval_requested: true,
      request_id: 'req-ui',
    });
    const parsed = parseMcpJsonResult({
      content: [{ type: 'text', text: inner }],
      approval_requested: false,
      approval_outcome: 'canceled',
    });
    expect(parsed?.approval_outcome).toBe('canceled');
    expect(parsed?.approval_requested).toBe(false);
  });

  it('prefers canceled approval fields over stale inner ok() text', () => {
    const inner = JSON.stringify({
      ok: true,
      approval_requested: true,
      request_id: 'req-cancel',
    });
    const parsed = parseMcpJsonResult({
      status: 'ok',
      content: inner,
      data: {
        content: [{ type: 'text', text: inner }],
        approval_requested: false,
        approval_outcome: 'canceled',
      },
    });
    expect(parsed?.approval_outcome).toBe('canceled');
    expect(parsed?.approval_requested).toBe(false);
  });

  it('unwraps MCP text content blocks', () => {
    const parsed = parseMcpJsonResult({
      content: [{ type: 'text', text: JSON.stringify({ ok: true, markdown: '# Plan' }) }],
    });
    expect(parsed?.markdown).toBe('# Plan');
  });
});
