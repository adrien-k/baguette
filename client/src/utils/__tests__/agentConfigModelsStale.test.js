import { describe, it, expect } from 'vitest';
import { isAgentConfigModelsStale } from '../agentConfigModelsStale.js';

describe('isAgentConfigModelsStale', () => {
  it('is stale until a list has loaded for the current config', () => {
    expect(isAgentConfigModelsStale(null, 2)).toBe(true);
    expect(isAgentConfigModelsStale(1, 2)).toBe(true);
    expect(isAgentConfigModelsStale('1', 2)).toBe(true);
    expect(isAgentConfigModelsStale(2, 2)).toBe(false);
    expect(isAgentConfigModelsStale('2', 2)).toBe(false);
  });

  it('is stale with no config', () => {
    expect(isAgentConfigModelsStale(2, null)).toBe(true);
    expect(isAgentConfigModelsStale(2, '')).toBe(true);
  });
});
