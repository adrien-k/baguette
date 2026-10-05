import { describe, it, expect, vi } from 'vitest';
import { MessageStreamWriter } from '../message-stream-writer.js';

describe('MessageStreamWriter', () => {
  it('forwards raw SDK events to appendRaw', async () => {
    const appendRaw = vi.fn().mockResolvedValue(undefined);
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 2,
      createRow: vi.fn(),
      patchRow: vi.fn(),
      appendRaw,
    });

    await writer.log({ type: 'test', value: 1 });
    expect(appendRaw).toHaveBeenCalledWith({ type: 'test', value: 1 });
  });

  it('persists ExitPlanMode as a plan row instead of tool_call', async () => {
    const createRow = vi.fn().mockResolvedValue({ id: 10 });
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 2,
      createRow,
      patchRow: vi.fn(),
    });

    await writer.handleClaudeEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tu_plan',
            name: 'ExitPlanMode',
            input: { plan: '# Do the thing\n\nStep 1.' },
          },
        ],
      },
    });

    expect(createRow).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(createRow.mock.calls[0][0].message_json);
    expect(payload).toEqual({ type: 'plan', markdown: '# Do the thing\n\nStep 1.' });
    expect(createRow.mock.calls[0][0].type).toBe('plan');
    expect(writer.pendingTools.has('tu_plan')).toBe(false);
  });

  it('patches one thinking_tokens row instead of creating many', async () => {
    const createRow = vi.fn().mockResolvedValue({ id: 50 });
    const patchRow = vi.fn().mockResolvedValue(undefined);
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 2,
      createRow,
      patchRow,
    });

    const first = {
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 10,
      estimated_tokens_delta: 10,
      uuid: 'a',
    };
    const second = {
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 14,
      estimated_tokens_delta: 4,
      uuid: 'b',
    };

    await writer.handleClaudeEvent(first);
    await writer.handleClaudeEvent(second);

    expect(createRow).toHaveBeenCalledTimes(1);
    expect(patchRow).toHaveBeenCalledTimes(1);
    const patch = patchRow.mock.calls[0][1];
    const patched = JSON.parse(patch.message_json);
    expect(patched).toEqual({
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 14,
      estimated_tokens_delta: 4,
    });
    expect(patch.subtype).toBe('thinking_tokens');
  });
});
