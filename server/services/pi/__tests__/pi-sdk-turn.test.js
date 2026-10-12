import { describe, expect, it, vi } from 'vitest';
import { processPiSessionStream } from '../pi-sdk-turn.ts';

describe('processPiSessionStream', () => {
  it('accumulates usage from turn_end events', async () => {
    const writer = {
      log: vi.fn(),
      apply: vi.fn().mockResolvedValue(undefined),
      finish: vi.fn().mockResolvedValue(undefined),
    };
    const events = [
      {
        type: 'turn_end',
        message: {
          model: 'glm-5.3-flash',
          usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120 },
        },
      },
      {
        type: 'turn_end',
        message: {
          model: 'glm-5.3-flash',
          usage: { input: 50, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 60 },
        },
      },
      { type: 'agent_settled' },
    ];
    const { finishedOk, turnUsage } = await processPiSessionStream({
      writer,
      subscribe: (listener) => {
        for (const event of events) listener(event);
        return () => {};
      },
      runPrompt: async () => {},
    });
    expect(finishedOk).toBe(true);
    expect(turnUsage.input_tokens).toBe(150);
    expect(turnUsage.output_tokens).toBe(30);
    expect(turnUsage.total_tokens).toBe(180);
    expect(turnUsage.model).toBe('glm-5.3-flash');
  });

  it('records turn_result error when the stream ends without agent_settled', async () => {
    const writer = {
      log: vi.fn(),
      apply: vi.fn().mockResolvedValue(undefined),
      finish: vi.fn().mockResolvedValue(undefined),
    };
    const { finishedOk } = await processPiSessionStream({
      writer,
      subscribe: (listener) => {
        listener({
          type: 'turn_end',
          message: {
            model: 'glm-5.3-flash',
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          },
        });
        return () => {};
      },
      runPrompt: async () => {},
    });
    expect(finishedOk).toBe(false);
    expect(writer.apply).toHaveBeenCalledWith([
      expect.objectContaining({
        op: 'turn_result',
        payload: expect.objectContaining({ status: 'error' }),
      }),
    ]);
  });

  it('treats assistant stopReason error as failure even when agent_settled follows', async () => {
    const authError =
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
    const writer = {
      log: vi.fn(),
      apply: vi.fn().mockResolvedValue(undefined),
      finish: vi.fn().mockResolvedValue(undefined),
    };
    const { finishedOk } = await processPiSessionStream({
      writer,
      subscribe: (listener) => {
        listener({
          type: 'turn_end',
          message: {
            role: 'assistant',
            stopReason: 'error',
            errorMessage: authError,
            model: 'claude-haiku-4-5',
            content: [],
          },
        });
        listener({ type: 'agent_end', messages: [], willRetry: false });
        listener({ type: 'agent_settled' });
        return () => {};
      },
      runPrompt: async () => {},
    });
    expect(finishedOk).toBe(false);
    expect(writer.apply).toHaveBeenCalledWith([
      expect.objectContaining({
        op: 'turn_result',
        payload: expect.objectContaining({
          status: 'error',
          error_message: authError,
        }),
      }),
    ]);
    const okResult = writer.apply.mock.calls.find((call) => call[0]?.[0]?.payload?.status === 'ok');
    expect(okResult).toBeUndefined();
  });

  it('uses extension_error detail in the fallback turn_result', async () => {
    const writer = {
      log: vi.fn(),
      apply: vi.fn().mockResolvedValue(undefined),
      finish: vi.fn().mockResolvedValue(undefined),
    };
    await processPiSessionStream({
      writer,
      subscribe: (listener) => {
        listener({
          type: 'extension_error',
          extensionPath: '/ext.ts',
          event: 'session_start',
          error: 'LunaRoute init failed',
        });
        return () => {};
      },
      runPrompt: async () => {},
    });
    expect(writer.apply).toHaveBeenCalledWith([
      expect.objectContaining({
        payload: expect.objectContaining({
          status: 'error',
          error_message: 'LunaRoute init failed',
        }),
      }),
    ]);
  });
});
