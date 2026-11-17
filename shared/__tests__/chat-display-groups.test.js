import { describe, it, expect } from 'vitest';
import {
  CHAT_WORK_COLLAPSE_MIN_CALLS,
  CHAT_WORK_VISIBLE_TAIL_CALLS,
  groupChatDisplayMessages,
  isChatAnchorMessage,
  isChatGroupBoundary,
  isChatWorkMessage,
  messageContainsPinnedChatTool,
  messageContainsPrUpsert,
} from '../chat-display-groups.js';

function toolCallRow(id, extras = {}) {
  return { type: 'tool_call', name: 'Read', id, call_id: String(id), ...extras };
}

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

  it('treats UpdateSession as a group boundary', () => {
    const updateSession = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'mcp',
            id: 'upd',
            input: { toolName: 'UpdateSession', args: { label: 't', description: 'd' } },
          },
        ],
      },
    };
    expect(messageContainsPrUpsert(updateSession)).toBe(true);
    expect(isChatGroupBoundary(updateSession)).toBe(true);
    expect(isChatWorkMessage(updateSession)).toBe(false);
  });

  it('treats typed tool_call PrUpsert as a group boundary', () => {
    const prUpsert = {
      type: 'tool_call',
      name: 'mcp__baguette__PrUpsert',
      id: 1,
      call_id: 'pr',
    };
    expect(messageContainsPrUpsert(prUpsert)).toBe(true);
    expect(isChatGroupBoundary(prUpsert)).toBe(true);
    expect(isChatWorkMessage(prUpsert)).toBe(false);
  });

  it('does not collapse CreatePlan into a surrounding Worked group', () => {
    const manyTools = Array.from({ length: CHAT_WORK_COLLAPSE_MIN_CALLS }, (_, i) => ({
      type: 'tool_use',
      name: 'Bash',
      id: `b${i}`,
    }));
    const messages = [
      { type: 'user', message: { content: 'go' } },
      { type: 'assistant', message: { content: manyTools } },
      {
        type: 'tool_call',
        kind: 'mcp',
        name: 'mcp__baguette__CreatePlan',
        args: { tool: 'CreatePlan', markdown: '# Plan' },
        id: 'plan',
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual(['message', 'work', 'message', 'message']);
    expect(grouped[2].message.kind).toBe('mcp');
  });

  it('does not collapse AskUserQuestions (ask_user) into a Worked group', () => {
    const manyTools = Array.from({ length: CHAT_WORK_COLLAPSE_MIN_CALLS }, (_, i) => ({
      type: 'tool_use',
      name: 'Bash',
      id: `b${i}`,
    }));
    const messages = [
      { type: 'user', message: { content: 'go' } },
      { type: 'assistant', message: { content: manyTools } },
      {
        type: 'tool_call',
        kind: 'ask_user',
        name: 'AskUserQuestions',
        args: { questions: [{ question: 'Pick one', options: [{ label: 'A' }] }] },
        id: 'ask',
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual(['message', 'work', 'message', 'message']);
    expect(grouped[2].message.kind).toBe('ask_user');
  });

  it('treats CreateIssue as a regular work tool (not a group boundary)', () => {
    const createIssue = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'mcp',
            id: 'iss',
            input: { toolName: 'CreateIssue', args: { severity: 'high', title: 'Leak' } },
          },
        ],
      },
    };
    expect(isChatGroupBoundary(createIssue)).toBe(false);
    expect(isChatWorkMessage(createIssue)).toBe(true);
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

  it('splits work at the last PrUpsert only', () => {
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

  it('collapses earlier PrUpsert into Worked; only the last stays visible', () => {
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
          content: [{ type: 'tool_use', name: 'mcp__baguette__PrUpsert', id: 'pr1' }],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'mcp', id: 'pr2', input: { toolName: 'PrUpsert' } }],
        },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual(['message', 'work', 'message', 'message']);
    expect(grouped[1].callCount).toBe(CHAT_WORK_COLLAPSE_MIN_CALLS + 1);
    expect(grouped[2].message.message.content[0].input.toolName).toBe('PrUpsert');
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

  it('keeps only the last 10 tool calls visible in an open work run', () => {
    const extra = 5;
    const total = CHAT_WORK_VISIBLE_TAIL_CALLS + extra;
    const messages = [
      { type: 'user', message: { content: 'go' } },
      ...Array.from({ length: total }, (_, i) => toolCallRow(i + 1)),
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped[0].kind).toBe('message');
    expect(grouped[1].kind).toBe('work');
    expect(grouped[1].callCount).toBe(extra);
    expect(grouped.slice(2)).toHaveLength(CHAT_WORK_VISIBLE_TAIL_CALLS);
    expect(grouped.slice(2).every((g) => g.kind === 'message')).toBe(true);
    expect(grouped.at(-1).message.id).toBe(total);
  });

  it('does not collapse an open run of at most 10 tool calls', () => {
    const messages = [
      { type: 'user', message: { content: 'go' } },
      ...Array.from({ length: CHAT_WORK_VISIBLE_TAIL_CALLS }, (_, i) => toolCallRow(i + 1)),
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.every((g) => g.kind === 'message')).toBe(true);
    expect(grouped).toHaveLength(1 + CHAT_WORK_VISIBLE_TAIL_CALLS);
  });

  it('still fully collapses a completed run even when it exceeds the visible tail', () => {
    const total = CHAT_WORK_VISIBLE_TAIL_CALLS + 4;
    const messages = [
      { type: 'user', message: { content: 'go' } },
      ...Array.from({ length: total }, (_, i) => toolCallRow(i + 1)),
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual(['message', 'work', 'message']);
    expect(grouped[1].callCount).toBe(total);
  });

  it('does not collapse StartSubagent into a surrounding Worked group', () => {
    const manyTools = Array.from({ length: CHAT_WORK_COLLAPSE_MIN_CALLS }, (_, i) => ({
      type: 'tool_use',
      name: 'Bash',
      id: `b${i}`,
    }));
    const messages = [
      { type: 'user', message: { content: 'go' } },
      { type: 'assistant', message: { content: manyTools } },
      {
        type: 'tool_call',
        kind: 'mcp',
        name: 'mcp__baguette__StartSubagent',
        args: { tool: 'StartSubagent', name: 'Scout' },
        id: 'sub',
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual(['message', 'work', 'message', 'message']);
    expect(grouped[2].message.args.tool).toBe('StartSubagent');
  });

  it('treats StartSubagent as a group boundary', () => {
    const startSubagent = {
      type: 'tool_call',
      kind: 'mcp',
      name: 'mcp__baguette__StartSubagent',
      args: { tool: 'StartSubagent', name: 'Scout' },
      id: 'sub',
    };
    expect(messageContainsPinnedChatTool(startSubagent)).toBe(true);
    expect(isChatGroupBoundary(startSubagent)).toBe(true);
    expect(isChatWorkMessage(startSubagent)).toBe(false);
  });

  it('does not collapse ConfigureMcpServer into a surrounding Worked group', () => {
    const manyTools = Array.from({ length: CHAT_WORK_COLLAPSE_MIN_CALLS }, (_, i) => ({
      type: 'tool_use',
      name: 'Bash',
      id: `b${i}`,
    }));
    const messages = [
      { type: 'user', message: { content: 'go' } },
      { type: 'assistant', message: { content: manyTools } },
      {
        type: 'tool_call',
        kind: 'mcp',
        name: 'mcp__baguette__ConfigureMcpServer',
        args: { name: 'docs' },
        id: 'cfg',
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual(['message', 'work', 'message', 'message']);
    expect(grouped[2].message.args.name).toBe('docs');
  });

  it('treats ConfigureMcpServer as a group boundary', () => {
    const configureServer = {
      type: 'tool_call',
      kind: 'mcp',
      name: 'mcp__baguette__ConfigureMcpServer',
      args: { name: 'docs', start_oauth: true },
      id: 'cfg',
    };
    expect(messageContainsPinnedChatTool(configureServer)).toBe(true);
    expect(isChatGroupBoundary(configureServer)).toBe(true);
    expect(isChatWorkMessage(configureServer)).toBe(false);
  });

  it('treats Cursor mcp meta-tool ConfigureMcpServer as a group boundary', () => {
    const configureServer = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'mcp',
            id: 'cfg',
            input: { toolName: 'ConfigureMcpServer', args: { name: 'docs', start_oauth: true } },
          },
        ],
      },
    };
    expect(messageContainsPinnedChatTool(configureServer)).toBe(true);
    expect(isChatGroupBoundary(configureServer)).toBe(true);
    expect(isChatWorkMessage(configureServer)).toBe(false);
  });

  it('folds mid-turn assistant messages into Worked; only the last stays visible', () => {
    const messages = [
      { type: 'user', message: { content: 'go' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Starting' }] } },
      toolCallRow(1),
      toolCallRow(2),
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Halfway' }] } },
      toolCallRow(3),
      { type: 'assistant', message: { content: [{ type: 'text', text: 'All done' }] } },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual(['message', 'work', 'message']);
    expect(grouped[1].callCount).toBe(3);
    expect(grouped[1].messages.map((m) => m.type)).toEqual([
      'assistant',
      'tool_call',
      'tool_call',
      'assistant',
      'tool_call',
    ]);
    expect(grouped[2].message.message.content[0].text).toBe('All done');
  });

  it("keeps a turn's only assistant message visible (no mid-turn folding)", () => {
    const messages = [
      { type: 'user', message: { content: 'go' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual(['message', 'message']);
  });

  it('folds consecutive mid-turn assistant texts even without tool calls', () => {
    const messages = [
      { type: 'user', message: { content: 'go' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'First' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Second' }] } },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual(['message', 'work', 'message']);
    expect(grouped[1].callCount).toBe(0);
    expect(grouped[1].messages[0].message.content[0].text).toBe('First');
    expect(grouped[2].message.message.content[0].text).toBe('Second');
  });

  it('keeps the last assistant message visible while the turn streams (no later anchor)', () => {
    const messages = [
      { type: 'user', message: { content: 'go' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Working…' }] } },
      toolCallRow(1),
      toolCallRow(2),
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual(['message', 'message', 'message', 'message']);
  });

  it('does not fold the assistant message before an errored turn result', () => {
    const messages = [
      { type: 'user', message: { content: 'go' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Investigating…' }] } },
      toolCallRow(1),
      { type: 'turn_result', status: 'error', error_message: 'boom', total_cost_usd: null },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual(['message', 'message', 'message', 'message']);
  });

  it('folds mid-turn assistants independently per turn', () => {
    const messages = [
      { type: 'user', message: { content: 'go' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'First mid' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'First final' }] } },
      { type: 'user', message: { content: 'again' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Second mid' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Second final' }] } },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual([
      'message',
      'work',
      'message',
      'message',
      'work',
      'message',
    ]);
    expect(grouped[1].messages[0].message.content[0].text).toBe('First mid');
    expect(grouped[4].messages[0].message.content[0].text).toBe('Second mid');
  });

  it('does not fold mid-turn assistants inside an expanded Worked group', () => {
    const run = [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Starting' }] } },
      toolCallRow(1),
      toolCallRow(2),
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Halfway' }] } },
      toolCallRow(3),
    ];
    const grouped = groupChatDisplayMessages(run, { foldMidTurnAssistants: false });
    expect(grouped.every((g) => g.kind === 'message')).toBe(true);
    expect(grouped).toHaveLength(run.length);
  });

  it('exposes mid-turn folding through the boundary and work helpers', () => {
    const first = { type: 'assistant', message: { content: [{ type: 'text', text: 'A' }] } };
    const second = { type: 'assistant', message: { content: [{ type: 'text', text: 'B' }] } };
    const messages = [{ type: 'user', message: { content: 'go' } }, first, second];
    // Backward-computed turn pointers: index 1 folds into index 2.
    const turnLastAnchors = [-1, 2, -1];
    const context = (index) => ({ messages, index, turnLastAnchors });
    expect(isChatWorkMessage(first, context(1))).toBe(true);
    expect(isChatGroupBoundary(first, context(1))).toBe(false);
    expect(isChatWorkMessage(second, context(2))).toBe(false);
    expect(isChatGroupBoundary(second, context(2))).toBe(true);
  });

  it('does not fold a mid-turn assistant that carries a pinned chat tool', () => {
    const messages = [
      { type: 'user', message: { content: 'go' } },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Pick one' },
            { type: 'tool_use', name: 'AskUserQuestions', id: 'ask' },
          ],
        },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
    ];
    const grouped = groupChatDisplayMessages(messages);
    expect(grouped.map((g) => g.kind)).toEqual(['message', 'message', 'message']);
    expect(messageContainsPinnedChatTool(messages[1])).toBe(true);
  });

  it('treats Cursor mcp meta-tool StartSubagent as a group boundary', () => {
    const startSubagent = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'mcp',
            id: 'sub',
            input: { toolName: 'StartSubagent', args: { name: 'Scout' } },
          },
        ],
      },
    };
    expect(messageContainsPinnedChatTool(startSubagent)).toBe(true);
    expect(isChatGroupBoundary(startSubagent)).toBe(true);
    expect(isChatWorkMessage(startSubagent)).toBe(false);
  });
});
