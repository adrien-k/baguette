import { describe, it, expect } from 'vitest';
import {
  attachSessionTurnModelFields,
  findLastTurnStartIndex,
  isHumanUserMessage,
  resolveTurnModel,
  turnModelCreateFields,
} from '../turn-model.js';

describe('resolveTurnModel', () => {
  const session = { model: 'session-opus', model_params: '[{"id":"x"}]' };

  it('uses explicit pair on the message row', () => {
    expect(
      resolveTurnModel({ model: 'composer', model_params: '[{"id":"fast"}]' }, session)
    ).toEqual({
      model: 'composer',
      modelParams: '[{"id":"fast"}]',
    });
  });

  it('uses session defaults when the message has no snapshot', () => {
    expect(resolveTurnModel({ message_json: '{}' }, session)).toEqual({
      model: 'session-opus',
      modelParams: '[{"id":"x"}]',
    });
  });

  it('uses explicit model with null params (Claude)', () => {
    expect(resolveTurnModel({ model: 'sonnet', model_params: null }, session)).toEqual({
      model: 'sonnet',
      modelParams: null,
    });
  });
});

describe('findLastTurnStartIndex', () => {
  it('returns the latest human or baguette user message index', () => {
    const messages = [
      { type: 'system', subtype: 'status' },
      { type: 'user', message: { role: 'user', content: 'first' } },
      { type: 'assistant', message: { content: [] } },
      { type: 'user', source: 'baguette', message: { role: 'user', content: 'nudge' } },
      { type: 'assistant', message: { content: [] } },
    ];
    expect(findLastTurnStartIndex(messages)).toBe(3);
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

  it('does not overwrite an explicit pair on the message', () => {
    const data = {
      type: 'user',
      model: 'sonnet',
      model_params: '[{"id":"fast","value":"false"}]',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi' } }),
    };
    attachSessionTurnModelFields(data, session);
    expect(data.model).toBe('sonnet');
    expect(data.model_params).toBe('[{"id":"fast","value":"false"}]');
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

  it('copies model-only snapshots with null params', () => {
    expect(turnModelCreateFields({ model: 'sonnet', model_params: null })).toEqual({
      model: 'sonnet',
      model_params: null,
    });
  });

  it('returns nothing when only model_params is set', () => {
    expect(turnModelCreateFields({ model_params: '[]' })).toEqual({});
  });
});
