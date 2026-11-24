import { describe, it, expect, vi } from 'vitest';
import { processAntigravityTurnStream } from '../sdk-turn.ts';

function makeWriter() {
  return {
    log: vi.fn(),
    apply: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn().mockResolvedValue(undefined),
  };
}

describe('processAntigravityTurnStream', () => {
  it('streams chunks, backfills missing MCP rawOutput from bridge queue, and maps usage', async () => {
    const writer = makeWriter();
    const consumeMcpToolResult = vi.fn(() => ({
      raw: [{ type: 'text', text: '{"ok":true}' }],
      isError: false,
    }));

    let listener = null;
    const result = await processAntigravityTurnStream({
      writer,
      model: 'gemini-3.8-flash',
      subscribe: (cb) => {
        listener = cb;
        return () => {};
      },
      consumeMcpToolResult,
      runPrompt: async () => {
        listener({
          sessionId: 'agy-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Working on it.' },
          },
        });
        listener({
          sessionId: 'agy-1',
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'mcp-1',
            title: 'CreateTodo',
            name: 'mcp_baguette_CreateTodo',
            status: 'in_progress',
            rawInput: { title: 'Test', toolSummary: 'create' },
          },
        });
        listener({
          sessionId: 'agy-1',
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'mcp-1',
            status: 'completed',
          },
        });
        return {
          stopReason: 'end_turn',
          usage: {
            inputTokens: 100,
            outputTokens: 40,
            cachedReadTokens: 25,
            cachedWriteTokens: 0,
            thoughtTokens: 15,
            totalTokens: 165,
          },
        };
      },
    });

    expect(result.finishedOk).toBe(true);
    expect(result.lastError).toBeNull();
    expect(result.stopReason).toBe('end_turn');
    expect(result.turnUsage).toEqual({
      input_tokens: 100,
      output_tokens: 40,
      cache_read_tokens: 25,
      cache_write_tokens: 0,
      reasoning_tokens: 15,
      total_tokens: 165,
      model: 'gemini-3.8-flash',
    });
    expect(consumeMcpToolResult).toHaveBeenCalledWith('CreateTodo');
    expect(writer.apply).toHaveBeenCalledWith([
      {
        op: 'tool_result',
        call_id: 'mcp-1',
        name: 'mcp__baguette__CreateTodo',
        raw: [{ type: 'text', text: '{"ok":true}' }],
        is_error: false,
        status: 'completed',
      },
    ]);
    expect(writer.apply).toHaveBeenLastCalledWith([
      expect.objectContaining({
        op: 'turn_result',
        payload: expect.objectContaining({ status: 'ok' }),
      }),
    ]);
    expect(writer.finish).toHaveBeenCalledTimes(1);
  });

  it('records error turn_result on refusal stopReason', async () => {
    const writer = makeWriter();
    const res = await processAntigravityTurnStream({
      writer,
      subscribe: () => () => {},
      runPrompt: async () => ({ stopReason: 'refusal' }),
    });
    expect(res.finishedOk).toBe(false);
    expect(res.lastError).toBe('Model refused to respond');
    expect(writer.apply).toHaveBeenCalledWith([
      expect.objectContaining({
        op: 'turn_result',
        payload: expect.objectContaining({
          status: 'error',
          error_message: 'Model refused to respond',
        }),
      }),
    ]);
  });

  it('treats abortSignal abort as stopped without recording an error turn_result', async () => {
    const writer = makeWriter();
    const controller = new AbortController();
    controller.abort();

    const res = await processAntigravityTurnStream({
      writer,
      abortSignal: controller.signal,
      subscribe: () => () => {},
      runPrompt: async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      },
    });
    expect(res.finishedOk).toBe(false);
    expect(res.lastError).toBeNull();
    expect(writer.apply).not.toHaveBeenCalled();
    expect(writer.finish).toHaveBeenCalledTimes(1);
  });

  it('rethrows prompt errors after persisting turn_result error', async () => {
    const writer = makeWriter();
    await expect(
      processAntigravityTurnStream({
        writer,
        subscribe: () => () => {},
        runPrompt: async () => {
          throw new Error('ACP transport died');
        },
      })
    ).rejects.toThrow('ACP transport died');

    expect(writer.apply).toHaveBeenCalledWith([
      expect.objectContaining({
        op: 'turn_result',
        payload: expect.objectContaining({
          status: 'error',
          error_message: 'ACP transport died',
        }),
      }),
    ]);
    expect(writer.finish).toHaveBeenCalledTimes(1);
  });
});
