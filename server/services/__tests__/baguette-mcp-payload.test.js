import { describe, it, expect } from 'vitest';
import {
  packSessionMessagesForMcp,
  jsonUtf8ByteLength,
  MCP_TOOL_PAYLOAD_MAX_BYTES,
} from '../baguette-mcp-payload.js';

describe('baguette-mcp-payload', () => {
  it('keeps small message lists under the byte cap', () => {
    const rows = [
      { id: 1, type: 'user', subtype: null, created_at: 't', message_json: '{"a":1}' },
      { id: 2, type: 'assistant', subtype: null, created_at: 't', message_json: '{"b":2}' },
    ];
    const packed = packSessionMessagesForMcp(rows);
    expect(packed.messages).toHaveLength(2);
    expect(
      jsonUtf8ByteLength({ messages: packed.messages, afterMessage: packed.nextAfterMessage })
    ).toBeLessThanOrEqual(MCP_TOOL_PAYLOAD_MAX_BYTES);
  });

  it('truncates oversized message_json in the list', () => {
    const big = 'x'.repeat(8000);
    const rows = [{ id: 1, type: 'user', subtype: null, created_at: 't', message_json: big }];
    const packed = packSessionMessagesForMcp(rows);
    expect(packed.messages[0].truncated).toBe(true);
    expect(packed.messages[0].totalBytes).toBe(8000);
    expect(packed.hint).toBeTruthy();
  });
});
