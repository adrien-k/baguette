import { describe, it, expect } from 'vitest';
import {
  coerceAgentConfigId,
  requireAgentConfigId,
  usageModelFieldsFromSnapshot,
} from '../usage-snapshot.js';

describe('coerceAgentConfigId', () => {
  it('coerces to a number and returns null otherwise', () => {
    expect(coerceAgentConfigId(3)).toBe(3);
    expect(coerceAgentConfigId('12')).toBe(12);
    expect(coerceAgentConfigId(null)).toBeNull();
    expect(coerceAgentConfigId('')).toBeNull();
  });
});

describe('requireAgentConfigId', () => {
  it('returns a finite config id', () => {
    expect(requireAgentConfigId(9)).toBe(9);
    expect(requireAgentConfigId('12')).toBe(12);
  });

  it('throws when omitted or invalid', () => {
    expect(() => requireAgentConfigId()).toThrow(
      'Agent configuration is required to run this turn'
    );
    expect(() => requireAgentConfigId(null)).toThrow(
      'Agent configuration is required to run this turn'
    );
  });
});

describe('usageModelFieldsFromSnapshot', () => {
  it('reads model and model_params from a snapshot', () => {
    expect(
      usageModelFieldsFromSnapshot({
        agent_type: 'reviewer',
        model: 'r',
        model_params: '[]',
      })
    ).toEqual({ model: 'r', paramsJson: '[]' });
  });

  it('returns nulls when snapshot is missing', () => {
    expect(usageModelFieldsFromSnapshot(null)).toEqual({ model: null, paramsJson: null });
  });
});
