import { describe, it, expect } from 'vitest';
import { builderMessageCreateFields, reviewComposerAgentFields } from '../messageCreateFields.js';

describe('reviewComposerAgentFields', () => {
  it('returns agent_sdk and model snapshot', () => {
    expect(
      reviewComposerAgentFields({
        agent_sdk: 'cursor',
        model: 'composer-1',
        model_params: '[{"id":"fast"}]',
      })
    ).toEqual({
      agent_sdk: 'cursor',
      model: 'composer-1',
      model_params: '[{"id":"fast"}]',
    });
  });

  it('throws when model is missing', () => {
    expect(() => reviewComposerAgentFields({ agent_sdk: 'claude', model: '' })).toThrow(
      /model is required/
    );
  });
});

describe('builderMessageCreateFields', () => {
  it('includes agent_type and session defaults', () => {
    expect(builderMessageCreateFields({ agent_sdk: 'claude', model: 'sonnet' })).toEqual({
      agent_type: 'builder',
      agent_sdk: 'claude',
      model: 'sonnet',
    });
  });
});
