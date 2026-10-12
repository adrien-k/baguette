import { describe, expect, it } from 'vitest';
import { claudeSdkOptionsFromModelParams } from '../claude-model-params.js';

describe('claudeSdkOptionsFromModelParams', () => {
  it('maps effort, context, and fast params to SDK options', () => {
    const options = claudeSdkOptionsFromModelParams([
      { id: 'effort', value: 'high' },
      { id: 'context', value: '1m' },
      { id: 'fast', value: 'true' },
    ]);
    expect(options).toEqual({
      effort: 'high',
      betas: ['context-1m-2025-08-07'],
      fastMode: true,
    });
  });

  it('returns empty object when params are missing', () => {
    expect(claudeSdkOptionsFromModelParams(null)).toEqual({});
  });
});
