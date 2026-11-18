import { describe, it, expect } from 'vitest';
import { registerAllSdkPlugins } from '../../agent-sdks/index.js';
import {
  mergeUsageForPrFooter,
  formatPrFooterModelSegment,
  formatPrFooterUsageLines,
  formatSlackFooterUsageSummary,
} from '../pr-footer-usage.js';

registerAllSdkPlugins();

const builderFastParams = JSON.stringify([{ id: 'fast', value: 'true' }]);
const reviewerSlowParams = JSON.stringify([{ id: 'fast', value: 'false' }]);

const builderAgent = { id: 1, ref: 1, name: 'Builder', agent_type: 'builder' };
const reviewerAgent = { id: 2, ref: 2, name: 'Reviewer', agent_type: 'reviewer' };

describe('mergeUsageForPrFooter', () => {
  it('merges session and review rows with the same sdk, model, and fast flag', () => {
    const merged = mergeUsageForPrFooter([
      {
        agent_id: 1,
        agent_type: 'builder',
        agent_sdk: 'cursor',
        model: 'composer-2.5',
        model_params: builderFastParams,
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 10,
        cache_write_tokens: 5,
        total_tokens: 165,
        cost_usd: 0.01,
      },
      {
        agent_id: 2,
        agent_type: 'reviewer',
        agent_sdk: 'claude',
        model: 'opus',
        model_params: null,
        input_tokens: 20,
        output_tokens: 10,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 30,
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

  it('does not merge builder and reviewer rows with the same sdk, model, and fast flag', () => {
    const merged = mergeUsageForPrFooter([
      {
        agent_id: 1,
        agent_type: 'builder',
        agent_sdk: 'claude',
        model: 'opus',
        model_params: null,
        input_tokens: 100,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 100,
        cost_usd: 0.1,
      },
      {
        agent_id: 2,
        agent_type: 'reviewer',
        agent_sdk: 'claude',
        model: 'opus',
        model_params: null,
        input_tokens: 50,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 50,
        cost_usd: 0.05,
      },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.agent_type).sort()).toEqual(['builder', 'reviewer']);
  });

  it('splits cursor rows when fast differs between builder and reviewer snapshots', () => {
    const merged = mergeUsageForPrFooter([
      {
        agent_id: 1,
        agent_type: 'builder',
        agent_sdk: 'cursor',
        model: 'composer-2.5',
        model_params: builderFastParams,
        input_tokens: 100,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 100,
        cost_usd: 0,
      },
      {
        agent_id: 2,
        agent_type: 'reviewer',
        agent_sdk: 'cursor',
        model: 'composer-2.5',
        model_params: reviewerSlowParams,
        input_tokens: 50,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 50,
        cost_usd: 0,
      },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.some((r) => r.fast)).toBe(true);
    expect(merged.some((r) => !r.fast)).toBe(true);
  });
});

describe('formatPrFooterUsageLines', () => {
  it('lists each agent with compact per-model cost and token totals', () => {
    const lines = formatPrFooterUsageLines(
      mergeUsageForPrFooter([
        {
          agent_id: 1,
          agent_type: 'builder',
          agent_sdk: 'claude',
          model: 'opus',
          model_params: null,
          input_tokens: 100,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          total_tokens: 100,
          cost_usd: 0.1,
        },
        {
          agent_id: 2,
          agent_type: 'reviewer',
          agent_sdk: 'claude',
          model: 'opus',
          model_params: null,
          input_tokens: 50,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          total_tokens: 50,
          cost_usd: 0.05,
        },
      ]),
      [builderAgent, reviewerAgent]
    );
    expect(lines[0]).toBe('LLM Usage:');
    expect(lines).toContainEqual('- #1 Builder - opus $0.10 / 100 tokens');
    expect(lines).toContainEqual('- #2 Reviewer - opus $0.05 / 50 tokens');
    expect(lines[lines.length - 1]).toBe('Total: $0.15');
  });

  it('orders agents by aggregated cost descending', () => {
    const lines = formatPrFooterUsageLines(
      mergeUsageForPrFooter([
        {
          agent_id: 1,
          agent_type: 'builder',
          agent_sdk: 'claude',
          model: 'opus',
          model_params: null,
          input_tokens: 10,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          total_tokens: 10,
          cost_usd: 0.01,
        },
        {
          agent_id: 2,
          agent_type: 'reviewer',
          agent_sdk: 'claude',
          model: 'opus',
          model_params: null,
          input_tokens: 100,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          total_tokens: 100,
          cost_usd: 0.5,
        },
      ]),
      [builderAgent, reviewerAgent]
    );
    expect(lines[1]).toBe('- #2 Reviewer - opus $0.50 / 100 tokens');
    expect(lines[2]).toBe('- #1 Builder - opus $0.01 / 10 tokens');
  });

  it('prefixes agent ref when multiple agents share default type labels', () => {
    const lines = formatPrFooterUsageLines(
      mergeUsageForPrFooter([
        {
          agent_id: 1,
          agent_type: 'builder',
          agent_sdk: 'cursor',
          model: 'composer-2.5',
          model_params: null,
          input_tokens: 100,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          total_tokens: 100,
          cost_usd: 0.1,
        },
        {
          agent_id: 3,
          agent_type: 'builder',
          agent_sdk: 'claude',
          model: 'opus',
          model_params: null,
          input_tokens: 50,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          total_tokens: 50,
          cost_usd: 0.05,
        },
      ]),
      [
        { id: 1, ref: 1, name: 'Builder', agent_type: 'builder' },
        { id: 3, ref: 3, name: 'Builder', agent_type: 'builder' },
      ]
    );
    expect(lines).toContainEqual('- #1 Builder - composer-2.5 $0.10 / 100 tokens');
    expect(lines).toContainEqual('- #3 Builder - opus $0.05 / 50 tokens');
  });

  it('uses custom subagent names when present', () => {
    const lines = formatPrFooterUsageLines(
      mergeUsageForPrFooter([
        {
          agent_id: 3,
          agent_type: 'subagent',
          agent_sdk: 'cursor',
          model: 'composer-2.5',
          model_params: null,
          input_tokens: 500,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          total_tokens: 500,
          cost_usd: 0.25,
        },
      ]),
      [{ id: 3, ref: 4, name: 'Research', agent_type: 'subagent' }]
    );
    expect(lines[1]).toBe('- #4 Research - composer-2.5 $0.25 / 500 tokens');
  });
});

describe('formatPrFooterModelSegment', () => {
  it('includes Fast in the label when enabled', () => {
    const line = formatPrFooterModelSegment({
      agent_sdk: 'cursor',
      model: 'composer-2.5',
      fast: true,
      input_tokens: 1500,
      output_tokens: 200,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 1700,
      cost_usd: 0.0042,
    });
    expect(line).toBe('composer-2.5 (Fast) $0.0042 / 1.7k tokens');
  });
});

describe('formatSlackFooterUsageSummary', () => {
  it('lists distinct models by cost and total session cost', () => {
    const summary = formatSlackFooterUsageSummary(
      mergeUsageForPrFooter([
        {
          agent_id: 1,
          agent_type: 'builder',
          agent_sdk: 'cursor',
          model: 'composer-2.5',
          model_params: null,
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          total_tokens: 0,
          cost_usd: 1.2,
        },
        {
          agent_id: 2,
          agent_type: 'reviewer',
          agent_sdk: 'claude',
          model: 'claude-opus-5',
          model_params: null,
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          total_tokens: 0,
          cost_usd: 0.3,
        },
      ])
    );
    expect(summary).toBe('composer-2.5, claude-opus-5 · $1.50');
  });

  it('returns null when there is no usage', () => {
    expect(formatSlackFooterUsageSummary([])).toBeNull();
  });
});
