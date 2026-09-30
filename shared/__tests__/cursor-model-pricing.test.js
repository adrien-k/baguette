import { describe, it, expect } from 'vitest';
import {
  estimateCursorTurnCostUsd,
  estimateCostUsdFromRates,
  hasCursorModelPricing,
  lookupCursorModelPricing,
} from '../cursor-model-pricing.js';

describe('cursor-model-pricing', () => {
  it('matches composer 2.5 fast vs non-fast', () => {
    expect(lookupCursorModelPricing('composer-2.5', [{ id: 'fast', value: 'true' }])).toEqual(
      expect.objectContaining({ input: 3, output: 15 })
    );
    expect(lookupCursorModelPricing('composer-2.5', [{ id: 'fast', value: 'false' }])).toEqual(
      expect.objectContaining({ input: 0.5, output: 2.5 })
    );
  });

  it('matches grok 4.7 500k fast variant', () => {
    const params = [
      { id: 'context', value: '500k' },
      { id: 'fast', value: 'true' },
    ];
    expect(lookupCursorModelPricing('grok-4.7', params)).toEqual(
      expect.objectContaining({ input: 6, output: 18 })
    );
  });

  it('returns null for unknown models', () => {
    expect(hasCursorModelPricing('auto-smart', [])).toBe(false);
    expect(hasCursorModelPricing('composer-2', [])).toBe(false);
  });

  it('matches Claude Opus 5.5 and Sonnet 5.5 list prices', () => {
    expect(lookupCursorModelPricing('claude-opus-5-5', [])).toEqual({
      input: 4,
      cacheWrite: 5,
      cacheRead: 0.2,
      output: 20,
    });
    expect(lookupCursorModelPricing('claude-sonnet-5-5', [])).toEqual({
      input: 2,
      cacheWrite: 2.5,
      cacheRead: 0.2,
      output: 10,
    });
  });

  it('estimates cost from token counts', () => {
    const turnUsage = {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
    };
    const cost = estimateCursorTurnCostUsd(turnUsage, 'gpt-5.4-nano', []);
    expect(cost).toBeCloseTo(0.2, 6);
  });

  it('does not bill reasoning tokens on top of output', () => {
    const priceRates = lookupCursorModelPricing('gpt-5.4-nano', []);
    const withReasoning = estimateCostUsdFromRates(
      { input_tokens: 0, output_tokens: 10, reasoning_tokens: 7, cache_read_tokens: 0 },
      priceRates
    );
    const outputOnly = estimateCostUsdFromRates(
      { input_tokens: 0, output_tokens: 10, reasoning_tokens: 0, cache_read_tokens: 0 },
      priceRates
    );
    expect(withReasoning).toBeCloseTo(outputOnly, 10);
  });

  it('applies cache read and output rates', () => {
    const priceRates = lookupCursorModelPricing('gpt-5.4-nano', []);
    const cost = estimateCostUsdFromRates(
      {
        input_tokens: 8007,
        output_tokens: 12,
        cache_read_tokens: 3,
        cache_write_tokens: 1,
        reasoning_tokens: 0,
      },
      priceRates
    );
    expect(cost).toBeCloseTo(0.00161646, 6);
  });
});
