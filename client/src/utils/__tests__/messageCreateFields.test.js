import { describe, it, expect } from 'vitest';
import { builderMessageCreateFields } from '../messageCreateFields.js';

describe('builderMessageCreateFields', () => {
  it('includes agent_type and session defaults', () => {
    expect(builderMessageCreateFields({ agent_sdk: 'claude', model: 'sonnet' })).toEqual({
      agent_type: 'builder',
      agent_sdk: 'claude',
      model: 'sonnet',
    });
  });
});
