import { describe, it, expect } from 'vitest';
import { mergeUsageForPrFooter, formatPrFooterUsageLine } from '../pr-footer-usage.js';

const builderFastParams = JSON.stringify([{ id: 'fast', value: 'true' }]);
const reviewerSlowParams = JSON.stringify([{ id: 'fast', value: 'false' }]);

describe('mergeUsageForPrFooter', () => {
  it('merges session and review rows with the same sdk, model, and fast flag', () => {
    const merged = mergeUsageForPrFooter([
      {
        agent_type: 'builder',
        agent_sdk: 'cursor',
        model: 'composer-2.5',
        model_params: builderFastParams,
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 10,
        cache_write_tokens: 5,
        cost_usd: 0.01,
      },
      {
        agent_type: 'reviewer',
        agent_sdk: 'claude',
        model: 'opus',
        model_params: null,
        input_tokens: 20,
        output_tokens: 10,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost_usd: 0.02,
      },
    ]);
    expect(merged).toHaveLength(2);
    const cursor = merged.find((r) => r.agent_sdk === 'cursor');
    expect(cursor.fast).toBe(true);
    expect(cursor.input_tokens).toBe(100);
    const claude = merged.find((r) => r.agent_sdk === 'claude');
    expect(claude.fast).toBe(false);
  });

  it('splits cursor rows when fast differs between builder and reviewer snapshots', () => {
    const merged = mergeUsageForPrFooter([
      {
        agent_type: 'builder',
        agent_sdk: 'cursor',
        model: 'composer-2.5',
        model_params: builderFastParams,
        input_tokens: 100,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost_usd: 0,
      },
      {
        agent_type: 'reviewer',
        agent_sdk: 'cursor',
        model: 'composer-2.5',
        model_params: reviewerSlowParams,
        input_tokens: 50,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost_usd: 0,
      },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.some((r) => r.fast)).toBe(true);
    expect(merged.some((r) => !r.fast)).toBe(true);
  });
});

describe('formatPrFooterUsageLine', () => {
  it('includes Fast in the label when enabled', () => {
    const line = formatPrFooterUsageLine({
      agent_sdk: 'cursor',
      model: 'composer-2.5',
      fast: true,
      input_tokens: 1500,
      output_tokens: 200,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: 0.0042,
    });
    expect(line).toContain('cursor / `composer-2.5` (Fast)');
    expect(line).toContain('In: 1.5k');
    expect(line).toContain('Cost: $0.0042');
  });
});
