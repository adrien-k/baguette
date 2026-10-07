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

  it('does not mark success when runPrompt ends without turn_result', async () => {
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
  });
});
