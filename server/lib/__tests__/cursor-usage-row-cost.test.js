import { describe, it, expect } from 'vitest';
import { applyCursorUsageDerivation } from '../../../shared/cursor-token-adjustment.js';
import { estimateCursorUsageCostUsd } from '../cursor-usage-row-cost.js';

describe('estimateCursorUsageCostUsd', () => {
  it('prices from usage model and snapshot params', () => {
    const snapshot = {
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
    expect(estimateCursorUsageCostUsd(turnUsage, snapshot)).toBeCloseTo(0.5, 6);
  });

  it('bills uncached input only when cache read is included in input', () => {
    const snapshot = { model: 'gpt-5.4-nano', model_params: null };
    const inflated = {
      input_tokens: 1000,
      output_tokens: 0,
      cache_read_tokens: 970,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 1970,
      model: 'gpt-5.4-nano',
    };
    const derived = { ...inflated };
    applyCursorUsageDerivation(derived);
    const uncached = { ...inflated, input_tokens: 30, total_tokens: 1000 };
    expect(estimateCursorUsageCostUsd(derived, snapshot)).toBeCloseTo(
      estimateCursorUsageCostUsd(uncached, snapshot),
      10
    );
  });

  it('prices from the snapshot model when the turn has no model', () => {
    const snapshot = {
      model: 'gpt-5.4-nano',
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
    expect(estimateCursorUsageCostUsd(turnUsage, snapshot)).toBeCloseTo(0.2, 6);
  });
});
