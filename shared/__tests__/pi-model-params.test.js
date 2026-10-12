import { describe, expect, it } from 'vitest';
import { piThinkingLevelFromModelParams } from '../pi-model-params.js';
import { attachPiModelVariants, piThinkingLevelsFromCatalogModel } from '../pi-model-variants.js';

describe('piThinkingLevelFromModelParams', () => {
  it('reads reasoning param as Pi thinking level', () => {
    expect(piThinkingLevelFromModelParams([{ id: 'reasoning', value: 'high' }])).toBe('high');
  });
});

describe('attachPiModelVariants', () => {
  it('filters thinking levels from thinkingLevelMap', () => {
    const levels = piThinkingLevelsFromCatalogModel({
      thinkingLevelMap: { off: null, low: 'low', high: 'high' },
    });
    expect(levels).toEqual(['low', 'high']);
  });

  it('builds reasoning variants for a model', () => {
    const model = attachPiModelVariants({ id: 'anthropic/claude-sonnet', display_name: 'Sonnet' });
    expect(model.variants?.length).toBeGreaterThan(0);
    expect(model.variants[0].params?.some((p) => p.id === 'reasoning')).toBe(true);
  });
});
