import { describe, it, expect } from 'vitest';
import { estimateCursorUsageCostUsd } from '../cursor-usage-row-cost.js';

describe('estimateCursorUsageCostUsd', () => {
  it('prices from usage model and session params', () => {
    const session = {
      model: 'composer-2.5',
      model_params: JSON.stringify([{ id: 'fast', value: 'false' }]),
    };
    const turnUsage = {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 1_000_000,
      model: 'composer-2.5',
    };
    expect(estimateCursorUsageCostUsd(turnUsage, session)).toBeCloseTo(0.5, 6);
  });

  it('uses review model fields when kind is review', () => {
    const session = {
      model: 'composer-2',
      review_model: 'gpt-5.4-nano',
      review_model_params: null,
      model_params: null,
    };
    const turnUsage = {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 1_000_000,
      model: null,
    };
    expect(estimateCursorUsageCostUsd(turnUsage, session, { kind: 'review' })).toBeCloseTo(0.2, 6);
  });
});
