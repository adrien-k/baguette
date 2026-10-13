import { describe, it, expect } from 'vitest';
import { builderMessageCreateFields } from '../messageCreateFields.js';

describe('builderMessageCreateFields', () => {
  it('includes agent_id and session defaults', () => {
    expect(
      builderMessageCreateFields(
        { agent_sdk: 'claude', model: 'sonnet' },
        { agent: { id: 7, agent_sdk: 'claude', model: 'sonnet' } }
      )
    ).toEqual({
      agent_id: 7,
      agent_sdk: 'claude',
      model: 'sonnet',
    });
  });
});
