/**
 * Both SDKs report usage as a running total, so every per-turn figure is a
 * difference against the previous snapshot — including across the counter reset
 * that a resumed session brings.
 */
import { describe, it, expect } from 'vitest';
import { addTokenUsage, delta, diffModelUsage, emptyTurnUsage } from '../turn-usage.js';

describe('delta', () => {
  it('returns the increment over the previous total', () => {
    expect(delta(10, 25)).toBe(15);
  });

  it('treats a counter that went backwards as a fresh start', () => {
    // A resumed session restarts the SDK's running total from zero.
    expect(delta(25, 4)).toBe(4);
  });

  it('handles absent values on either side', () => {
    expect(delta(undefined, 5)).toBe(5);
    expect(delta(5, undefined)).toBe(0);
    expect(delta(undefined, undefined)).toBe(0);
  });
});

describe('addTokenUsage', () => {
  it('accumulates across the runs of one turn', () => {
    const acc = emptyTurnUsage();
    addTokenUsage(acc, {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 2,
      totalTokens: 127,
    });
    addTokenUsage(acc, { inputTokens: 50, outputTokens: 10, reasoningTokens: 7, totalTokens: 60 });

    expect(acc).toEqual({
      input_tokens: 150,
      output_tokens: 30,
      cache_read_tokens: 5,
      cache_write_tokens: 2,
      reasoning_tokens: 7,
      total_tokens: 187,
      model: null,
    });
  });

  it('ignores a run that reported no usage', () => {
    expect(addTokenUsage(emptyTurnUsage(), undefined)).toEqual(emptyTurnUsage());
  });
});

describe('diffModelUsage', () => {
  const usage = (input, output, cacheRead = 0, cacheWrite = 0) => ({
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheWrite,
  });

  it('reports the whole snapshot on the first turn', () => {
    const turn = diffModelUsage({}, { 'claude-opus-5': usage(100, 20, 5, 3) });
    expect(turn.input_tokens).toBe(100);
    expect(turn.output_tokens).toBe(20);
    expect(turn.cache_read_tokens).toBe(5);
    expect(turn.cache_write_tokens).toBe(3);
    expect(turn.total_tokens).toBe(128);
    expect(turn.model).toBe('claude-opus-5');
  });

  it('subtracts the previous running total on later turns', () => {
    const prev = { 'claude-opus-5': usage(100, 20) };
    const next = { 'claude-opus-5': usage(260, 45) };
    const turn = diffModelUsage(prev, next);
    expect(turn.input_tokens).toBe(160);
    expect(turn.output_tokens).toBe(25);
    expect(turn.total_tokens).toBe(185);
  });

  it('sums across models and names the one that did the most work', () => {
    const turn = diffModelUsage(
      { 'claude-opus-5': usage(100, 20) },
      { 'claude-opus-5': usage(150, 30), 'claude-haiku-4-5': usage(400, 10) }
    );
    expect(turn.input_tokens).toBe(450); // 50 + 400
    expect(turn.output_tokens).toBe(20); // 10 + 10
    expect(turn.model).toBe('claude-haiku-4-5');
  });

  it('counts a reset counter as new work rather than going negative', () => {
    const turn = diffModelUsage(
      { 'claude-opus-5': usage(500, 90) },
      { 'claude-opus-5': usage(12, 3) }
    );
    expect(turn.input_tokens).toBe(12);
    expect(turn.output_tokens).toBe(3);
    expect(turn.total_tokens).toBe(15);
  });

  it('returns an empty turn when the result carried no modelUsage', () => {
    expect(diffModelUsage({}, undefined)).toEqual(emptyTurnUsage());
  });

  it('leaves the model null when no model moved any tokens', () => {
    const same = { 'claude-opus-5': usage(100, 20) };
    const turn = diffModelUsage(same, same);
    expect(turn.total_tokens).toBe(0);
    expect(turn.model).toBeNull();
  });
});
