import { describe, it, expect } from 'vitest';
import { builderMessageCreateFields, reviewComposerAgentFields } from '../messageCreateFields.js';

describe('reviewComposerAgentFields', () => {
  it('returns the whole turn snapshot — config id, sdk, model pair', () => {
    expect(
      reviewComposerAgentFields({
        agent_sdk: 'cursor',
        model: 'composer-1',
        model_params: '[{"id":"fast"}]',
        review_agent_config_id: 9,
      })
    ).toEqual({
      agent_sdk: 'cursor',
      model: 'composer-1',
      model_params: '[{"id":"fast"}]',
      review_agent_config_id: 9,
    });
  });

  it('keeps model_params explicit when the review has none', () => {
    expect(reviewComposerAgentFields({ agent_sdk: 'claude', model: 'sonnet' })).toEqual({
      agent_sdk: 'claude',
      model: 'sonnet',
      model_params: null,
      review_agent_config_id: null,
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
