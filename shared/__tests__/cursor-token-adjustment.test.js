import { describe, it, expect } from 'vitest';
import {
  applyCursorUsageDerivation,
  buildCursorRawTokenUsage,
  deriveCursorUsageFromRaw,
  parseCursorRawTokenUsage,
} from '../cursor-token-adjustment.js';

describe('deriveCursorUsageFromRaw', () => {
  it('subtracts cache read from input and total when input is inclusive', () => {
    expect(
      deriveCursorUsageFromRaw({
        input_tokens: 1000,
        cache_read_tokens: 970,
        total_tokens: 2000,
      })
    ).toEqual({
      input_tokens: 30,
      total_tokens: 1030,
    });
  });

  it('keeps small uncached input when cache read is larger', () => {
    expect(
      deriveCursorUsageFromRaw({
        input_tokens: 7,
        cache_read_tokens: 147_695,
        total_tokens: 187_033,
      })
    ).toEqual({
      input_tokens: 7,
      total_tokens: 187_033,
    });
  });
});

describe('applyCursorUsageDerivation', () => {
  it('persists raw JSON and derives scalar input/total', () => {
    const turn = {
      input_tokens: 500,
      output_tokens: 10,
      cache_read_tokens: 400,
      cache_write_tokens: 2,
      reasoning_tokens: 0,
      total_tokens: 1000,
    };
    applyCursorUsageDerivation(turn);
    expect(parseCursorRawTokenUsage(turn.raw_token_usage)).toEqual(
      buildCursorRawTokenUsage({
        input_tokens: 500,
        output_tokens: 10,
        cache_read_tokens: 400,
        cache_write_tokens: 2,
        reasoning_tokens: 0,
        total_tokens: 1000,
      })
    );
    expect(turn.input_tokens).toBe(100);
    expect(turn.total_tokens).toBe(600);
  });
});
