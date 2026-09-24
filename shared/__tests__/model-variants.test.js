import { describe, it, expect } from 'vitest';
import { pickPreferredVariantIdx, resolveCursorModelParams } from '../model-variants.js';

describe('model-variants', () => {
  const variants = [
    {
      is_default: true,
      params: [
        { id: 'fast', value: 'false' },
        { id: 'effort', value: 'medium' },
      ],
    },
    {
      is_default: false,
      params: [
        { id: 'fast', value: 'true' },
        { id: 'effort', value: 'high' },
      ],
    },
  ];

  it('pickPreferredVariantIdx prefers matching preference variant', () => {
    const idx = pickPreferredVariantIdx(variants, 'yes', 'high');
    expect(idx).toBe(1);
  });

  it('resolveCursorModelParams applies preferences on default', () => {
    const models = [{ id: 'm1', variants }];
    const json = resolveCursorModelParams({
      models,
      modelId: 'm1',
      cursorFast: 'yes',
      cursorEffort: 'high',
    });
    expect(JSON.parse(json)).toEqual([
      { id: 'fast', value: 'true' },
      { id: 'effort', value: 'high' },
    ]);
  });
});
