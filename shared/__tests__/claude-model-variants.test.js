import { describe, expect, it } from 'vitest';
import {
  attachClaudeModelVariants,
  claudeModelSupports1mContext,
  claudeModelVariantAxes,
} from '../claude-model-variants.js';

const FIVE_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const FOUR_LEVELS = ['low', 'medium', 'high', 'max'];
const THREE_LEVELS = ['low', 'medium', 'high'];

function effortValues(modelId) {
  return claudeModelVariantAxes(null, modelId).find((a) => a.id === 'effort')?.values;
}

function defaultVariantParams(model) {
  const params = model.variants?.find((v) => v.is_default)?.params ?? [];
  return Object.fromEntries(params.map((p) => [p.id, p.value]));
}

describe('claudeModelVariantAxes', () => {
  it('uses SDK effort metadata when present', () => {
    const axes = claudeModelVariantAxes(
      { supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
      'claude-opus-4-7'
    );
    expect(axes.find((a) => a.id === 'effort')?.values).toEqual(['low', 'high']);
  });

  it('prefers SDK effort metadata over heuristics for 5.5-family ids', () => {
    const axes = claudeModelVariantAxes(
      { supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
      'claude-opus-5-5'
    );
    expect(axes.find((a) => a.id === 'effort')?.values).toEqual(['low', 'high']);
  });

  it('falls back to base levels when SDK metadata lacks supportedEffortLevels', () => {
    const axes = claudeModelVariantAxes({ supportsEffort: true }, 'claude-opus-4-7');
    expect(axes.find((a) => a.id === 'effort')?.values).toEqual(THREE_LEVELS);
  });

  it('adds 1m context for sonnet 4 models', () => {
    expect(claudeModelSupports1mContext('claude-sonnet-4-6')).toBe(true);
    const axes = claudeModelVariantAxes(null, 'claude-sonnet-4-6');
    expect(axes.some((a) => a.id === 'context' && a.values.includes('1m'))).toBe(true);
  });

  it('offers all five effort levels to the current Anthropic table', () => {
    const ids = [
      'claude-opus-5-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-sonnet-5-5',
      'claude-sonnet-5',
      'claude-haiku-5-5',
      'claude-fable-5',
      'claude-fable-5-1',
      'claude-mythos-5',
      'claude-mythos-5-1',
    ];
    for (const id of ids) {
      expect(effortValues(id)).toEqual(FIVE_LEVELS);
    }
  });

  it('offers max without xhigh to Opus 4.6 and Sonnet 4.6', () => {
    expect(effortValues('claude-opus-4-6')).toEqual(FOUR_LEVELS);
    expect(effortValues('claude-sonnet-4-6')).toEqual(FOUR_LEVELS);
  });

  it('keeps base levels for older effort-capable models', () => {
    expect(effortValues('claude-opus-4-5')).toEqual(THREE_LEVELS);
    expect(effortValues('claude-sonnet-4-5')).toEqual(THREE_LEVELS);
    expect(effortValues('claude-haiku-4-5')).toEqual(THREE_LEVELS);
  });

  it('does not add an effort axis for non-effort models', () => {
    expect(claudeModelVariantAxes(null, 'grok-4.7')).toEqual([]);
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

  it('marks exactly one variant as default', () => {
    const model = attachClaudeModelVariants({
      id: 'claude-opus-5-5',
      display_name: 'Opus 5.5',
    });
    expect(model.variants.filter((v) => v.is_default)).toHaveLength(1);
  });

  it('defaults to medium effort on Opus 5.5 and Haiku 5.5', () => {
    for (const id of ['claude-opus-5-5', 'claude-haiku-5-5']) {
      const params = defaultVariantParams(attachClaudeModelVariants({ id, display_name: id }));
      expect(params.effort, id).toBe('medium');
    }
  });

  it('defaults to high effort on other effort-capable models', () => {
    const ids = ['claude-opus-4-7', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-4-6'];
    for (const id of ids) {
      const params = defaultVariantParams(attachClaudeModelVariants({ id, display_name: id }));
      expect(params.effort, id).toBe('high');
    }
  });

  it('keeps the fast and context defaults when those axes exist', () => {
    const params = defaultVariantParams(
      attachClaudeModelVariants({ id: 'claude-opus-4-7', display_name: 'Opus 4.7' })
    );
    expect(params.fast).toBe('false');
    expect(params.context).toBe('200k');
  });

  it('clamps the default effort to SDK-provided levels', () => {
    const model = attachClaudeModelVariants({
      id: 'claude-opus-5-5',
      display_name: 'Opus 5.5',
      _claudeModelInfo: { supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
    });
    expect(defaultVariantParams(model).effort).toBe('high');
  });
});
