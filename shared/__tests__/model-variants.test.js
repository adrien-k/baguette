import { describe, it, expect } from 'vitest';
import {
  pickPreferredVariantIdx,
  resolveCursorModelParams,
  mergeModelParam,
  paramValueOptionsFromVariants,
  resolveParamsAfterParamChange,
  formatParamLabel,
  isBinaryParamOptions,
  orderedParamIdsFromVariants,
  nearestContextOption,
  effortOptionFromPref,
  reasoningOptionFromPref,
  paramValueFromPref,
  applyParamOverrides,
  resolveVariantForStoredParams,
} from '../model-variants.js';

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
    const idx = pickPreferredVariantIdx(variants, {
      cursor_fast: 'yes',
      cursor_effort: 'high',
    });
    expect(idx).toBe(1);
  });

  it('orderedParamIdsFromVariants uses composer order', () => {
    const ids = orderedParamIdsFromVariants([
      {
        params: [
          { id: 'cyber', value: 'false' },
          { id: 'fast', value: 'true' },
          { id: 'thinking', value: 'false' },
          { id: 'context', value: '1m' },
          { id: 'reasoning', value: 'medium' },
          { id: 'effort', value: 'high' },
        ],
      },
    ]);
    expect(ids).toEqual(['fast', 'thinking', 'effort', 'reasoning', 'context', 'cyber']);
  });

  it('paramValueOptionsFromVariants collects distinct values when no other params set', () => {
    expect(paramValueOptionsFromVariants(variants, 'effort')).toEqual(['medium', 'high']);
  });

  it('paramValueOptionsFromVariants only offers compatible values', () => {
    expect(paramValueOptionsFromVariants(variants, 'effort', variants[0].params)).toEqual([
      'medium',
    ]);
    expect(paramValueOptionsFromVariants(variants, 'fast', variants[0].params)).toEqual(['false']);
    expect(paramValueOptionsFromVariants(variants, 'fast', variants[1].params)).toEqual(['true']);
  });

  it('formatParamLabel capitalizes param ids', () => {
    expect(formatParamLabel('effort')).toBe('Effort');
    expect(formatParamLabel('auto-push')).toBe('Auto-push');
  });

  it('isBinaryParamOptions detects on/off, true/false, and yes/no pairs', () => {
    expect(isBinaryParamOptions(['on', 'off'])).toBe(true);
    expect(isBinaryParamOptions(['false', 'true'])).toBe(true);
    expect(isBinaryParamOptions(['no', 'yes'])).toBe(true);
    expect(isBinaryParamOptions(['false'])).toBe(true);
    expect(isBinaryParamOptions(['low', 'medium', 'high'])).toBe(false);
  });

  it('resolveParamsAfterParamChange returns a real variant param set', () => {
    expect(
      resolveParamsAfterParamChange(variants, variants[0].params, 'fast', 'true', [
        'fast',
        'effort',
      ])
    ).toEqual(variants[1].params);
  });

  it('mergeModelParam updates one field and preserves order', () => {
    const base = variants[0].params;
    expect(mergeModelParam(base, 'effort', 'high', ['fast', 'effort'])).toEqual([
      { id: 'fast', value: 'false' },
      { id: 'effort', value: 'high' },
    ]);
  });

  it('resolveCursorModelParams applies preferences on default', () => {
    const models = [{ id: 'm1', variants }];
    const json = resolveCursorModelParams({
      models,
      modelId: 'm1',
      cursorModelPrefs: { cursor_fast: 'yes', cursor_effort: 'high' },
    });
    expect(JSON.parse(json)).toEqual([
      { id: 'fast', value: 'true' },
      { id: 'effort', value: 'high' },
    ]);
  });
});

describe('preference matching: effort', () => {
  const opts = ['low', 'medium', 'high'];

  it('uses exact match when available', () => {
    expect(effortOptionFromPref('high', opts)).toBe('high');
    expect(effortOptionFromPref('medium', opts)).toBe('medium');
  });

  it('steps down to the next lower tier when pref is above all offered values', () => {
    expect(effortOptionFromPref('xhigh', opts)).toBe('high');
    expect(effortOptionFromPref('max', opts)).toBe('high');
    expect(effortOptionFromPref('high', ['low', 'medium'])).toBe('medium');
  });

  it('steps down one tier when pref is between offered values', () => {
    expect(effortOptionFromPref('xhigh', ['low', 'high'])).toBe('high');
    expect(effortOptionFromPref('high', ['low', 'medium'])).toBe('medium');
  });

  it('uses lowest offered tier when pref is below every option', () => {
    expect(effortOptionFromPref('low', ['medium', 'high'])).toBe('medium');
  });

  it('paramValueFromPref wires effort matching', () => {
    expect(
      paramValueFromPref('effort', 'xhigh', { effortOptions: ['low', 'medium', 'high'] })
    ).toBe('high');
    expect(paramValueFromPref('effort', 'default', { effortOptions: opts })).toBeUndefined();
  });

  it('applyParamOverrides applies effort step-down via variant options', () => {
    const params = [{ id: 'effort', value: 'low' }];
    const modelVariants = [
      { params },
      { params: [{ id: 'effort', value: 'medium' }] },
      { params: [{ id: 'effort', value: 'high' }] },
    ];
    const out = applyParamOverrides(params, { cursor_effort: 'xhigh' }, modelVariants);
    expect(out[0].value).toBe('high');
  });

  it('pickPreferredVariantIdx selects variant after effort step-down', () => {
    const effortVariants = [
      { is_default: true, params: [{ id: 'effort', value: 'low' }] },
      { is_default: false, params: [{ id: 'effort', value: 'medium' }] },
      { is_default: false, params: [{ id: 'effort', value: 'high' }] },
    ];
    const idx = pickPreferredVariantIdx(effortVariants, { cursor_effort: 'max' });
    expect(idx).toBe(2);
  });
});

describe('preference matching: reasoning', () => {
  it('steps down when pref is above available reasoning tiers', () => {
    expect(reasoningOptionFromPref('max', ['none', 'low', 'high'])).toBe('high');
    expect(reasoningOptionFromPref('extra-high', ['low', 'medium', 'high'])).toBe('high');
  });

  it('paramValueFromPref wires reasoning tier matching', () => {
    expect(
      paramValueFromPref('reasoning', 'max', {
        reasoningOptions: ['none', 'low', 'medium', 'high'],
      })
    ).toBe('high');
  });
});

describe('preference matching: context', () => {
  it('nearestContextOption picks closest size', () => {
    expect(nearestContextOption('1m', ['200k', '300k', '1m'])).toBe('1m');
    expect(nearestContextOption('280k', ['200k', '300k', '1m'])).toBe('300k');
    expect(nearestContextOption('350k', ['200k', '300k', '1m'])).toBe('300k');
    expect(nearestContextOption('150k', ['200k', '300k'])).toBe('200k');
  });

  it('paramValueFromPref wires context nearest match', () => {
    expect(paramValueFromPref('context', '350k', { contextOptions: ['200k', '300k', '1m'] })).toBe(
      '300k'
    );
    expect(paramValueFromPref('context', 'default', { contextOptions: ['300k'] })).toBeUndefined();
  });

  it('applyParamOverrides maps context preference to nearest option', () => {
    const params = [
      { id: 'fast', value: 'false' },
      { id: 'context', value: '300k' },
    ];
    const modelVariants = [
      { params },
      {
        params: [
          { id: 'fast', value: 'false' },
          { id: 'context', value: '1m' },
        ],
      },
    ];
    const out = applyParamOverrides(params, { cursor_context: '350k' }, modelVariants);
    expect(out.find((p) => p.id === 'context').value).toBe('300k');
  });
});

describe('preference matching: yes/no params', () => {
  it('maps yes/no prefs to true/false for fast, thinking, and cyber', () => {
    expect(paramValueFromPref('fast', 'yes', {})).toBe('true');
    expect(paramValueFromPref('fast', 'no', {})).toBe('false');
    expect(paramValueFromPref('thinking', 'yes', {})).toBe('true');
    expect(paramValueFromPref('cyber', 'no', {})).toBe('false');
    expect(paramValueFromPref('fast', 'default', {})).toBeUndefined();
  });

  it('applyParamOverrides applies binary prefs on variants', () => {
    const params = [
      { id: 'fast', value: 'false' },
      { id: 'thinking', value: 'false' },
      { id: 'cyber', value: 'false' },
    ];
    const out = applyParamOverrides(
      params,
      {
        cursor_fast: 'yes',
        cursor_thinking: 'yes',
        cursor_cyber: 'no',
      },
      [{ params }]
    );
    expect(out).toEqual([
      { id: 'fast', value: 'true' },
      { id: 'thinking', value: 'true' },
      { id: 'cyber', value: 'false' },
    ]);
  });

  it('applies cursor_effort tier snapping to reasoning_effort params', () => {
    const params = [{ id: 'reasoning_effort', value: 'medium' }];
    const modelVariants = [
      { params: [{ id: 'reasoning_effort', value: 'medium' }] },
      { params: [{ id: 'reasoning_effort', value: 'high' }] },
      { params: [{ id: 'reasoning_effort', value: 'xhigh' }] },
    ];
    const out = applyParamOverrides(params, { cursor_effort: 'max' }, modelVariants);
    expect(out[0].value).toBe('xhigh');
  });
});

describe('resolveVariantForStoredParams', () => {
  const grokVariants = [
    {
      params: [
        { id: 'context', value: '500k' },
        { id: 'reasoning_effort', value: 'xhigh' },
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

  it('returns exact variant params without pref overrides', () => {
    const stored = grokVariants[0].params;
    expect(resolveVariantForStoredParams(grokVariants, stored)).toEqual(stored);
  });

  it('applies prefs when resolving closest non-exact snapshot', () => {
    const stale = [
      { id: 'effort', value: 'medium' },
      { id: 'fast', value: 'false' },
    ];
    const out = resolveVariantForStoredParams(grokVariants, stale, { cursor_effort: 'max' });
    expect(out?.find((p) => p.id === 'reasoning_effort')?.value).toBe('xhigh');
  });

  it('with no stored params uses closest user prefs', () => {
    const out = resolveVariantForStoredParams(grokVariants, null, {
      cursor_fast: 'yes',
      cursor_effort: 'high',
    });
    expect(out).toEqual(grokVariants[1].params);
  });
});
