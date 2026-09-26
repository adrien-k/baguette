import { describe, it, expect } from 'vitest';
import {
  attachSessionTurnModelFields,
  isHumanUserMessage,
  resolveTurnModel,
  turnModelCreateFields,
} from '../turn-model.js';

describe('resolveTurnModel', () => {
  const session = { model: 'session-opus', model_params: '[{"id":"x"}]' };

  it('uses the explicit message model and does not mix session params', () => {
    expect(resolveTurnModel({ model: 'sonnet' }, session)).toEqual({
      model: 'sonnet',
      modelParams: null,
    });
  });

  it('uses explicit model_params with the message model', () => {
    expect(
      resolveTurnModel({ model: 'composer', model_params: '[{"id":"fast"}]' }, session)
    ).toEqual({
      model: 'composer',
      modelParams: '[{"id":"fast"}]',
    });
  });

  it('falls back to the session default when the message has no model', () => {
    expect(resolveTurnModel({ message_json: '{}' }, session)).toEqual({
      model: 'session-opus',
      modelParams: '[{"id":"x"}]',
    });
  });
});

describe('isHumanUserMessage', () => {
  it('rejects baguette and tool-result user messages', () => {
    expect(isHumanUserMessage({ type: 'user', source: 'baguette' })).toBe(false);
    expect(
      isHumanUserMessage({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: '' }] },
      })
    ).toBe(false);
  });

  it('accepts plain user text', () => {
    expect(isHumanUserMessage({ type: 'user', message: { role: 'user', content: 'hi' } })).toBe(
      true
    );
  });
});

describe('attachSessionTurnModelFields', () => {
  const session = { model: 'opus', model_params: '[{"id":"fast"}]' };

  it('copies session model onto human user messages without a snapshot', () => {
    const data = {
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi' } }),
    };
    attachSessionTurnModelFields(data, session);
    expect(data.model).toBe('opus');
    expect(data.model_params).toBe('[{"id":"fast"}]');
  });

  it('leaves an explicit message model unchanged', () => {
    const data = {
      type: 'user',
      model: 'sonnet',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi' } }),
    };
    attachSessionTurnModelFields(data, session);
    expect(data.model).toBe('sonnet');
    expect(data.model_params).toBeUndefined();
  });

  it('copies session model onto baguette user messages', () => {
    const data = {
      type: 'user',
      message_json: JSON.stringify({
        type: 'user',
        source: 'baguette',
        title: 'Loop',
        message: { role: 'user', content: 'run' },
      }),
    };
    attachSessionTurnModelFields(data, session);
    expect(data.model).toBe('opus');
    expect(data.model_params).toBe('[{"id":"fast"}]');
  });
});

describe('turnModelCreateFields', () => {
  it('omits empty model so the turn uses the session default', () => {
    expect(turnModelCreateFields({})).toEqual({});
    expect(turnModelCreateFields({ model: '', model_params: null })).toEqual({});
  });

  it('copies a snapshot for composer/queue/loop creates', () => {
    expect(turnModelCreateFields({ model: 'sonnet', model_params: '[]' })).toEqual({
      model: 'sonnet',
      model_params: '[]',
    });
  });
});
