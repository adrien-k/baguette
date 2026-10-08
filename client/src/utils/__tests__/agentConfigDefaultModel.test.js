import { describe, it, expect } from 'vitest';
import {
  defaultModelPayloadFromPicker,
  localStateFromConfigDefault,
  modelPatchFromConfigDefault,
} from '../agentConfigDefaultModel.js';

describe('modelPatchFromConfigDefault', () => {
  it('uses the config default when set', () => {
    expect(
      modelPatchFromConfigDefault({
        default_model: { model: 'sonnet', model_params: [{ id: 'fast', value: 'true' }] },
      })
    ).toEqual({
      model: 'sonnet',
      model_params: '[{"id":"fast","value":"true"}]',
    });
  });

  it('keeps current model when missing unless clearIfMissing', () => {
    expect(modelPatchFromConfigDefault({})).toEqual({});
    expect(modelPatchFromConfigDefault({}, { clearIfMissing: true })).toEqual({
      model: null,
      model_params: null,
    });
  });

  it('maps review field names', () => {
    expect(
      modelPatchFromConfigDefault(
        { default_model: { model: 'opus' } },
        { modelKey: 'review_model', paramsKey: 'review_model_params', clearIfMissing: true }
      )
    ).toEqual({ review_model: 'opus', review_model_params: null });
  });
});

describe('defaultModelPayloadFromPicker', () => {
  it('builds API payload from picker values', () => {
    expect(
      defaultModelPayloadFromPicker('composer', JSON.stringify([{ id: 'fast', value: 'true' }]))
    ).toEqual({
      model: 'composer',
      model_params: [{ id: 'fast', value: 'true' }],
    });
    expect(defaultModelPayloadFromPicker('', null)).toBe(null);
  });
});

describe('localStateFromConfigDefault', () => {
  it('stringifies params for local picker state', () => {
    expect(
      localStateFromConfigDefault({
        default_model: { model: 'composer', model_params: [{ id: 'fast', value: 'true' }] },
      })
    ).toEqual({
      model: 'composer',
      modelParamsJson: JSON.stringify([{ id: 'fast', value: 'true' }]),
    });
  });
});
