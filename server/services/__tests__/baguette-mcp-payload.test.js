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
});
