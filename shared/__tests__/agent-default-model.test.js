import { describe, it, expect } from 'vitest';
import { parseAgentDefaultModelJson, stringifyAgentDefaultModel } from '../agent-default-model.js';

describe('agent-default-model', () => {
  it('parses model and params', () => {
    expect(
      parseAgentDefaultModelJson(
        JSON.stringify({ model: 'composer', model_params: [{ id: 'fast', value: 'true' }] })
      )
    ).toEqual({
      model: 'composer',
      model_params: [{ id: 'fast', value: 'true' }],
    });
  });

  it('stringify omits empty payload', () => {
    expect(stringifyAgentDefaultModel({ model: null, model_params: null })).toBe(null);
    expect(stringifyAgentDefaultModel({ model: 'sonnet', model_params: null })).toBe(
      JSON.stringify({ model: 'sonnet', model_params: null })
    );
  });
});
