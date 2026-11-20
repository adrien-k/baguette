import { describe, it, expect } from 'vitest';
import { packSessionMessagesForMcp, MCP_MESSAGES_PAGE_SIZE } from '../baguette-mcp-payload.js';

describe('baguette-mcp-payload', () => {
  it('packs rows into message entries', () => {
    const rows = [
      { id: 1, type: 'user', subtype: null, created_at: 't', message_json: '{"a":1}' },
      { id: 2, type: 'assistant', subtype: null, created_at: 't', message_json: '{"b":2}' },
    ];
    const packed = packSessionMessagesForMcp(rows);
    expect(packed.messages).toHaveLength(2);
    expect(packed.messages[0]).toMatchObject({ id: 1, type: 'user', message_json: '{"a":1}' });
    expect(packed.nextMessageId).toBeNull();
    expect(packed.hasMore).toBe(false);
  });

  it('exposes the default page size of 50', () => {
    expect(MCP_MESSAGES_PAGE_SIZE).toBe(50);
  });

  it('reports nextMessageId when more rows exist', () => {
    const rows = [
      { id: 1, type: 'user', subtype: null, created_at: 't', message_json: '{"a":1}' },
      { id: 2, type: 'assistant', subtype: null, created_at: 't', message_json: '{"b":2}' },
    ];
    const packed = packSessionMessagesForMcp(rows, { hasMoreRows: true });
    expect(packed.nextMessageId).toBe(2);
    expect(packed.hasMore).toBe(true);
  });

  it('strips thinking blocks from assistant messages', () => {
    const rows = [
      {
        id: 1,
        type: 'assistant',
        subtype: null,
        created_at: 't',
        message_json: JSON.stringify({
          type: 'assistant',
          blocks: [
            { type: 'thinking', thinking: 'pondering' },
            { type: 'text', text: 'answer' },
          ],
        }),
      },
    ];
    const packed = packSessionMessagesForMcp(rows);
    expect(packed.messages).toHaveLength(1);
    const payload = JSON.parse(packed.messages[0].message_json);
    expect(payload.blocks).toEqual([{ type: 'text', text: 'answer' }]);
  });

  it('skips thinking-only assistant rows and advances pagination past them', () => {
    const rows = [
      {
        id: 1,
        type: 'assistant',
        subtype: null,
        created_at: 't',
        message_json: JSON.stringify({
          type: 'assistant',
          blocks: [{ type: 'thinking', thinking: 'pondering' }],
        }),
      },
      { id: 2, type: 'user', subtype: null, created_at: 't', message_json: '{"a":1}' },
    ];
    const packed = packSessionMessagesForMcp(rows);
    expect(packed.messages).toHaveLength(1);
    expect(packed.messages[0].id).toBe(2);
    expect(packed.hasMore).toBe(false);
  });

  it('keeps nextMessageId on trailing thinking-only rows when more rows exist', () => {
    const rows = [
      { id: 1, type: 'user', subtype: null, created_at: 't', message_json: '{"a":1}' },
      {
        id: 2,
        type: 'assistant',
        subtype: null,
        created_at: 't',
        message_json: JSON.stringify({
          type: 'assistant',
          blocks: [{ type: 'thinking', thinking: 'pondering' }],
        }),
      },
    ];
    const packed = packSessionMessagesForMcp(rows, { hasMoreRows: true });
    expect(packed.messages).toHaveLength(1);
    expect(packed.nextMessageId).toBe(2);
    expect(packed.hasMore).toBe(true);
  });

  it('keeps non-assistant payloads with thinking-like fields untouched', () => {
    const messageJson = JSON.stringify({ blocks: [{ type: 'thinking', thinking: 'x' }] });
    const rows = [
      { id: 1, type: 'user', subtype: null, created_at: 't', message_json: messageJson },
    ];
    const packed = packSessionMessagesForMcp(rows);
    expect(packed.messages[0].message_json).toBe(messageJson);
  });

  it('returns an empty page with nextMessageId when all rows are thinking-only', () => {
    const rows = [
      {
        id: 1,
        type: 'assistant',
        subtype: null,
        created_at: 't',
        message_json: JSON.stringify({
          type: 'assistant',
          blocks: [{ type: 'thinking', thinking: 'pondering' }],
        }),
      },
    ];
    const packed = packSessionMessagesForMcp(rows, { hasMoreRows: true });
    expect(packed.messages).toHaveLength(0);
    expect(packed.nextMessageId).toBe(1);
    expect(packed.hasMore).toBe(true);
  });

  it('shortens tool call rows to the tool, status, timing and clipped arguments and result', () => {
    const call = {
      type: 'tool_call',
      id: 'c1',
      name: 'Read',
      status: 'completed',
      kind: 'generic',
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-01T00:00:01.000Z',
      args: { path: 'a'.repeat(2000) },
      result: { content: 'b'.repeat(5000) },
    };
    const { messages } = packSessionMessagesForMcp([
      { id: 1, type: 'tool_call', created_at: 't', message_json: JSON.stringify(call) },
    ]);
    const packed = JSON.parse(messages[0].message_json);
    expect(packed).toMatchObject({ type: 'tool_call', name: 'Read', status: 'completed' });
    expect(packed.id).toBeUndefined();
    expect(packed.args.length).toBeLessThanOrEqual(400);
    expect(packed.result.length).toBeLessThanOrEqual(600);
    expect(packed.result.endsWith('…')).toBe(true);
  });

  it('keeps a tool call without a result as it is, and tolerates an unreadable row', () => {
    const running = { type: 'tool_call', name: 'Bash', status: 'running', args: { command: 'ls' } };
    const { messages } = packSessionMessagesForMcp([
      { id: 1, type: 'tool_call', message_json: JSON.stringify(running) },
      { id: 2, type: 'tool_call', message_json: 'not json' },
    ]);
    expect(JSON.parse(messages[0].message_json)).toMatchObject({ status: 'running', result: null });
    expect(messages[1].message_json).toBe('not json');
  });
});
