import { describe, it, expect } from 'vitest';
import { usagePricingSnapshotForCost } from '../usage-pricing-snapshot.js';

describe('usagePricingSnapshotForCost', () => {
  it('reads model and params from the turn snapshot', () => {
    const turnModel = {
      model: 'composer-2.5',
      modelParams: JSON.stringify([{ id: 'fast', value: 'true' }]),
    };
    expect(usagePricingSnapshotForCost(turnModel)).toEqual({
      model: 'composer-2.5',
      model_params: turnModel.modelParams,
    });
  });

  it('prefers the billed model from turn usage when present', () => {
    const turnModel = { model: 'sonnet', modelParams: null };
    expect(usagePricingSnapshotForCost(turnModel, { model: 'claude-opus-5' }).model).toBe(
      'claude-opus-5'
    );
  });

  it('throws when the turn has no model', () => {
    expect(() => usagePricingSnapshotForCost(null)).toThrow('Model is required to record usage');
    expect(() => usagePricingSnapshotForCost({ model: '' })).toThrow(
      'Model is required to record usage'
    );
  });
});
