import { describe, it, expect } from 'vitest';
import {
  parseAgentSessionDefaultsJson,
  resolveCreateSessionAgentFields,
  withLastUsedFlag,
} from '../agent-session-defaults.js';

describe('resolveCreateSessionAgentFields', () => {
  const stored = {
    agent_sdk: 'cursor',
    model: 'composer',
    model_params: [{ id: 'fast', value: 'true' }],
  };

  it('uses stored defaults when MCP omits fields', () => {
    expect(resolveCreateSessionAgentFields({}, stored)).toEqual({
      agent_sdk: 'cursor',
      model: 'composer',
      model_params: [{ id: 'fast', value: 'true' }],
      variant_index: undefined,
    });
  });

  it('explicit params override stored defaults', () => {
    expect(
      resolveCreateSessionAgentFields(
        { agent_sdk: 'claude', model: 'sonnet', variant_index: 0 },
        stored
      )
    ).toEqual({
      agent_sdk: 'claude',
      model: 'sonnet',
      model_params: undefined,
      variant_index: 0,
    });
  });

  it('does not apply stored model when explicit SDK differs', () => {
    expect(resolveCreateSessionAgentFields({ agent_sdk: 'claude' }, stored)).toEqual({
      agent_sdk: 'claude',
      model: undefined,
      model_params: undefined,
      variant_index: undefined,
    });
  });

  it('falls back to claude when last-used mode has no prior session', () => {
    expect(resolveCreateSessionAgentFields({}, parseAgentSessionDefaultsJson(null))).toEqual({
      agent_sdk: 'claude',
      model: undefined,
      model_params: undefined,
      variant_index: undefined,
    });
  });

  it('uses last session when defaults are in last-used mode', () => {
    expect(
      resolveCreateSessionAgentFields(
        {},
        { agent_sdk: null, model: null, model_params: null },
        { agent_sdk: 'cursor', model: 'composer', model_params: [{ id: 'fast', value: 'true' }] }
      )
    ).toEqual({
      agent_sdk: 'cursor',
      model: 'composer',
      model_params: [{ id: 'fast', value: 'true' }],
      variant_index: undefined,
    });
  });
});

describe('withLastUsedFlag', () => {
  it('marks empty defaults as last-used', () => {
    expect(withLastUsedFlag(null)).toMatchObject({ use_last_used: true, agent_sdk: null });
    expect(withLastUsedFlag({ agent_sdk: 'claude', model: 'sonnet' })).toMatchObject({
      use_last_used: false,
      agent_sdk: 'claude',
    });
  });
});

describe('parseAgentSessionDefaultsJson', () => {
  it('parses model_params arrays', () => {
    expect(
      parseAgentSessionDefaultsJson({
        agent_sdk: 'cursor',
        model: 'm',
        model_params: [{ id: 'effort', value: 'high' }],
      })
    ).toEqual({
      agent_sdk: 'cursor',
      model: 'm',
      model_params: [{ id: 'effort', value: 'high' }],
    });
  });
});
