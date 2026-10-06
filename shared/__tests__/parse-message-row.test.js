import { describe, it, expect } from 'vitest';
import { parseMessageRow } from '../parse-message-row.ts';

const baseRow = {
  turn_id: null,
  tool_call_id: null,
  tool_status: null,
  tool_started_at: null,
  tool_ended_at: null,
  created_at: '2026-01-01T00:00:00Z',
  total_cost_usd: null,
};

describe('parseMessageRow', () => {
  it('parses typed MCP user rows', () => {
    const view = parseMessageRow({
      id: 1,
      session_id: 2,
      type: 'user',
      subtype: 'mcp',
      message_json: JSON.stringify({
        type: 'user',
        source: 'mcp',
        content: 'ping',
      }),
      ...baseRow,
    });
    expect(view.type).toBe('user');
    expect(view.content).toBe('ping');
    expect(view.source).toBe('mcp');
  });

  it('normalizes legacy MCP SDK envelope to typed user view', () => {
    const view = parseMessageRow({
      id: 1,
      session_id: 2,
      type: 'user',
      subtype: 'mcp',
      message_json: JSON.stringify({
        type: 'user',
        source: 'mcp',
        message: { role: 'user', content: 'hello mcp' },
      }),
      ...baseRow,
    });
    expect(view.content).toBe('hello mcp');
  });

  it('parses thinking_tokens system rows', () => {
    const view = parseMessageRow({
      id: 3,
      session_id: 2,
      type: 'system',
      subtype: 'thinking_tokens',
      message_json: JSON.stringify({
        type: 'system',
        subtype: 'thinking_tokens',
        estimated_tokens: 1200,
      }),
      ...baseRow,
    });
    expect(view.type).toBe('system');
    expect(view.subtype).toBe('thinking_tokens');
    expect(view.estimated_tokens).toBe(1200);
  });

  it('coerces legacy assistant SDK rows to typed blocks', () => {
    const view = parseMessageRow({
      id: 4,
      session_id: 2,
      type: 'assistant',
      subtype: null,
      message_json: JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello' }] },
      }),
      ...baseRow,
    });
    expect(view.type).toBe('assistant');
    expect(view.blocks[0].text).toBe('Hello');
  });

  it('hides tool-result carrier user rows', () => {
    const view = parseMessageRow({
      id: 5,
      session_id: 2,
      type: 'user',
      subtype: null,
      message_json: JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
      }),
      ...baseRow,
    });
    expect(view.type).toBe('tool_result_carrier');
  });
});
