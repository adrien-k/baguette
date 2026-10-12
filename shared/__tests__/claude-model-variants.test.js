import { describe, expect, it } from 'vitest';
import {
  attachClaudeModelVariants,
  claudeModelSupports1mContext,
  claudeModelVariantAxes,
} from '../claude-model-variants.js';

describe('claudeModelVariantAxes', () => {
  it('uses SDK effort metadata when present', () => {
    const axes = claudeModelVariantAxes(
      { supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
      'claude-opus-4-7'
    );
    expect(axes.find((a) => a.id === 'effort')?.values).toEqual(['low', 'high']);
  });

  it('adds 1m context for sonnet 4 models', () => {
    expect(claudeModelSupports1mContext('claude-sonnet-4-6')).toBe(true);
    const axes = claudeModelVariantAxes(null, 'claude-sonnet-4-6');
    expect(axes.some((a) => a.id === 'context' && a.values.includes('1m'))).toBe(true);
  });
});

describe('attachClaudeModelVariants', () => {
  it('attaches variants for a gateway-style model id', () => {
    const model = attachClaudeModelVariants({
      id: 'claude-opus-4-7',
      display_name: 'Opus 4.7',
    });
    expect(model.variants?.length).toBeGreaterThan(0);
    expect(model.variants[0].params?.length).toBeGreaterThan(0);
  });
});
