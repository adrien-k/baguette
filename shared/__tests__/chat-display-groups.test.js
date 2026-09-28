import { describe, it, expect } from 'vitest';
import {
  CHAT_WORK_COLLAPSE_MIN_CALLS,
  groupChatDisplayMessages,
  isChatAnchorMessage,
  isChatGroupBoundary,
  isChatWorkMessage,
  messageContainsPrUpsert,
} from '../chat-display-groups.js';

describe('chat display grouping', () => {
  it('classifies assistant with text as anchor and tool-only as work', () => {
    expect(
      isChatAnchorMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hi' }] },
      })
    ).toBe(true);
    expect(
      isChatWorkMessage({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Bash', id: '1' }] },
      })
    ).toBe(true);
  });

  it('treats PrUpsert tool messages as group boundaries', () => {
    const prUpsert = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'mcp__baguette__PrUpsert', id: 'pr' }],
      },
    };
    expect(messageContainsPrUpsert(prUpsert)).toBe(true);
    expect(isChatGroupBoundary(prUpsert)).toBe(true);
    expect(isChatWorkMessage(prUpsert)).toBe(false);
  });

  it('treats Cursor mcp meta-tool PrUpsert as a group boundary', () => {
    const prUpsert = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'mcp',
            id: 'pr',
            input: { toolName: 'PrUpsert', args: { title: 't', description: 'd' } },
          },
        ],
      },
    };
    expect(messageContainsPrUpsert(prUpsert)).toBe(true);
    expect(isChatGroupBoundary(prUpsert)).toBe(true);
    expect(isChatWorkMessage(prUpsert)).toBe(false);
  });

  it('does not collapse Cursor PrUpsert into a surrounding Worked group', () => {
    const manyTools = Array.from({ length: CHAT_WORK_COLLAPSE_MIN_CALLS }, (_, i) => ({
      type: 'tool_use',
      name: 'Bash',
      id: `b${i}`,
    }));
    const messages = [
      { type: 'user', message: { content: 'go' } },
      { type: 'assistant', message: { content: manyTools } },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'mcp', id: 'pr', input: { toolName: 'PrUpsert' } }],
        },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual(['message', 'work', 'message', 'message']);
    expect(grouped[2].message.message.content[0].input.toolName).toBe('PrUpsert');
  });

  it('does not collapse work with at most five tool calls', () => {
    const messages = [
      { type: 'user', message: { content: 'go' }, created_at: '2026-01-01T00:00:00Z' },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Bash', id: 'a' }] },
        created_at: '2026-01-01T00:00:10Z',
      },
      { type: 'result', subtype: 'success', created_at: '2026-01-01T00:01:00Z' },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Done' }] },
        created_at: '2026-01-01T00:01:05Z',
      },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped).toHaveLength(4);
    expect(grouped.every((g) => g.kind === 'message')).toBe(true);
  });

  it('collapses work when a later boundary exists and call count exceeds five', () => {
    const toolBlocks = Array.from({ length: CHAT_WORK_COLLAPSE_MIN_CALLS }, (_, i) => ({
      type: 'tool_use',
      name: 'Bash',
      id: `t${i}`,
    }));
    const messages = [
      { type: 'user', message: { content: 'go' }, created_at: '2026-01-01T00:00:00Z' },
      {
        type: 'assistant',
        message: { content: toolBlocks },
        created_at: '2026-01-01T00:00:10Z',
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Done' }] },
        created_at: '2026-01-01T00:01:05Z',
      },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped).toHaveLength(3);
    expect(grouped[1].kind).toBe('work');
    expect(grouped[1].callCount).toBe(CHAT_WORK_COLLAPSE_MIN_CALLS);
  });

  it('splits work at PrUpsert so only the segment after the last boundary collapses', () => {
    const fewTools = [{ type: 'tool_use', name: 'Read', id: 'r1' }];
    const manyTools = Array.from({ length: CHAT_WORK_COLLAPSE_MIN_CALLS }, (_, i) => ({
      type: 'tool_use',
      name: 'Bash',
      id: `b${i}`,
    }));
    const messages = [
      { type: 'user', message: { content: 'go' } },
      { type: 'assistant', message: { content: manyTools } },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'mcp__baguette__PrUpsert', id: 'pr' }] },
      },
      { type: 'assistant', message: { content: fewTools } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
    ];
    const grouped = groupChatDisplayMessages(messages);
    const kinds = grouped.map((g) => g.kind);
    expect(kinds).toEqual(['message', 'work', 'message', 'message', 'message']);
    expect(grouped[1].callCount).toBe(CHAT_WORK_COLLAPSE_MIN_CALLS);
  });

  it('does not collapse trailing work without a following anchor', () => {
    const messages = [
      { type: 'user', message: { content: 'go' } },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Bash', id: 'a' }] },
      },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped).toHaveLength(2);
    expect(grouped.every((g) => g.kind === 'message')).toBe(true);
  });
});
