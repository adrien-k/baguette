import { describe, it, expect } from 'vitest';
import { usageConfigIdFromSnapshot, usageModelFieldsFromSnapshot } from '../usage-snapshot.js';

describe('usageConfigIdFromSnapshot', () => {
  it('reads merged session virtual fields', () => {
    expect(usageConfigIdFromSnapshot({ agent_config_id: 5 }, 'chat')).toBe(5);
    expect(
      usageConfigIdFromSnapshot({ agent_config_id: 5, review_agent_config_id: 9 }, 'review')
    ).toBe(9);
  });

  it('reads agents table rows by agent_type', () => {
    expect(usageConfigIdFromSnapshot({ agent_type: 'builder', agent_config_id: 3 }, 'chat')).toBe(
      3
    );
    expect(
      usageConfigIdFromSnapshot({ agent_type: 'reviewer', agent_config_id: 7 }, 'review')
    ).toBe(7);
    expect(
      usageConfigIdFromSnapshot({ agent_type: 'builder', agent_config_id: 3 }, 'review')
    ).toBeNull();
  });
});

describe('usageModelFieldsFromSnapshot', () => {
  it('reads merged session fields', () => {
    expect(usageModelFieldsFromSnapshot({ model: 'a', review_model: 'b' }, 'review').model).toBe(
      'b'
    );
    expect(usageModelFieldsFromSnapshot({ model: 'a', review_model: 'b' }, 'chat').model).toBe('a');
  });

  it('reads agents table rows', () => {
    expect(
      usageModelFieldsFromSnapshot(
        { agent_type: 'reviewer', model: 'r', model_params: '[]' },
        'review'
      )
    ).toEqual({ model: 'r', paramsJson: '[]' });
  });
});
