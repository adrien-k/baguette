import { describe, it, expect } from 'vitest';
import {
  attachSessionTurnModelFields,
  findLastTurnStartIndex,
  isHumanUserMessage,
  isMcpUserMessage,
  requireTurnModelFromRow,
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

describe('requireTurnModelFromRow', () => {
  it('requires the model snapshot on the row — no session fallback', () => {
    expect(requireTurnModelFromRow({ model: 'sonnet' })).toEqual({
      model: 'sonnet',
      modelParams: null,
    });
    expect(() => requireTurnModelFromRow({}, { sdk: 'claude' })).toThrow(
      'Message is missing model for this turn (claude)'
    );
    expect(() => requireTurnModelFromRow({ model: '   ' })).toThrow(
      'Message is missing model for this turn'
    );
  });

  it('ignores the session — turns never inherit session defaults at run time', () => {
    expect(() =>
      requireTurnModelFromRow(
        { message_json: '{}' },
        {
          sdk: 'claude',
        }
      )
    ).toThrow('Message is missing model for this turn (claude)');
  });

  it('requires model_params on the row for Cursor turns', () => {
    expect(
      requireTurnModelFromRow(
        { model: 'composer', model_params: '[{"id":"max"}]' },
        {
          sdk: 'cursor',
        }
      )
    ).toEqual({ model: 'composer', modelParams: '[{"id":"max"}]' });
    expect(() => requireTurnModelFromRow({ model: 'composer' }, { sdk: 'cursor' })).toThrow(
      'Message is missing model_params for this Cursor turn'
    );
  });

  it('does not require model_params for other SDKs', () => {
    expect(requireTurnModelFromRow({ model: 'pi-main' }, { sdk: 'pi' })).toEqual({
      model: 'pi-main',
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

  it('returns the latest MCP user message index', () => {
    const messages = [
      { type: 'user', message: { role: 'user', content: 'first' } },
      { type: 'assistant', message: { content: [] } },
      { type: 'user', source: 'mcp', content: 'scheduled hello', subtype: 'mcp' },
    ];
    expect(findLastTurnStartIndex(messages)).toBe(2);
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

  it('accepts stored user content with file_reference blocks', () => {
    expect(
      isHumanUserMessage({
        type: 'user',
        content: [
          { type: 'file_reference', path: 'README.md', line: 28, change: 'removed' },
          { type: 'text', text: 'test' },
        ],
      })
    ).toBe(true);
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

describe('isMcpUserMessage', () => {
  it('is not treated as a human user message', () => {
    const mcp = { type: 'user', source: 'mcp', content: 'ping' };
    expect(isMcpUserMessage(mcp)).toBe(true);
    expect(isHumanUserMessage(mcp)).toBe(false);
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
