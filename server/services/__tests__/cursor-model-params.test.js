import { describe, it, expect } from 'vitest';
import { findVariantForStoredParams } from '../../../shared/model-variants.js';
import { resolveCursorAgentModelParams } from '../cursor-model-params.js';

const grok47Variants = [
  {
    is_default: false,
    params: [
      { id: 'context', value: '500k' },
      { id: 'reasoning_effort', value: 'xhigh' },
      { id: 'fast', value: 'false' },
    ],
  },
  {
    is_default: false,
    params: [
      { id: 'reasoning_effort', value: 'medium' },
      { id: 'fast', value: 'false' },
    ],
  },
  {
    is_default: true,
    params: [
      { id: 'reasoning_effort', value: 'high' },
      { id: 'fast', value: 'true' },
    ],
  },
];

const models = [{ id: 'grok-4.7', variants: grok47Variants }];

describe('resolveCursorAgentModelParams', () => {
  it('maps stored reasoning_effort to registry variant param ids and order', () => {
    const stored = [
      { id: 'context', value: '500k' },
      { id: 'reasoning_effort', value: 'xhigh' },
      { id: 'fast', value: 'false' },
    ];
    expect(
      resolveCursorAgentModelParams({
        models,
        modelId: 'grok-4.7',
        modelParams: stored,
      })
    ).toEqual(grok47Variants[0].params);
  });

  it('keeps params that match a variant exactly', () => {
    const params = [
      { id: 'reasoning_effort', value: 'high' },
      { id: 'fast', value: 'true' },
    ];
    expect(
      resolveCursorAgentModelParams({
        models,
        modelId: 'grok-4.7',
        modelParams: params,
      })
    ).toEqual(params);
  });

  it('picks the closest variant for stale effort params on the same model', () => {
    const stale = [
      { id: 'effort', value: 'medium' },
      { id: 'fast', value: 'false' },
    ];
    expect(
      resolveCursorAgentModelParams({
        models,
        modelId: 'grok-4.7',
        modelParams: stale,
      })
    ).toEqual(grok47Variants[1].params);
  });

  it('returns stored params when the model is not in the registry list', () => {
    const params = [{ id: 'fast', value: 'true' }];
    expect(
      resolveCursorAgentModelParams({
        models: [],
        modelId: 'unknown-model',
        modelParams: params,
      })
    ).toEqual(params);
  });
});

describe('findVariantForStoredParams', () => {
  it('matches effort alias against reasoning_effort variants', () => {
    const variant = findVariantForStoredParams(grok47Variants, [
      { id: 'context', value: '500k' },
      { id: 'effort', value: 'xhigh' },
      { id: 'fast', value: 'false' },
    ]);
    expect(variant?.params).toEqual(grok47Variants[0].params);
  });
});
