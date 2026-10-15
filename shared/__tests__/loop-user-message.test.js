import { describe, it, expect } from 'vitest';
import {
  buildLoopUserMessageJson,
  buildLoopUserMessagePayload,
  loopUserRowSubtypeFromMessageJson,
} from '../loop-user-message.js';
import { isHumanUserMessage, isLoopUserMessage, isTurnStartingUserMessage } from '../turn-model.js';
import { normalizeUserPayloadForStorage } from '../normalize-user-payload.js';

describe('loop user messages', () => {
  it('builds typed loop payload and subtype helper', () => {
    const json = buildLoopUserMessageJson('tick', { title: 'Nightly' });
    expect(buildLoopUserMessagePayload('tick', { title: 'Nightly' })).toEqual({
      type: 'user',
      source: 'loop',
      subtype: 'loop',
      content: 'tick',
      title: 'Nightly',
    });
    expect(loopUserRowSubtypeFromMessageJson(json)).toBe('loop');
  });

  it('normalizes and classifies loop user rows', () => {
    const parsed = normalizeUserPayloadForStorage(JSON.parse(buildLoopUserMessageJson('go')));
    expect(parsed.source).toBe('loop');
    expect(isLoopUserMessage(parsed)).toBe(true);
    expect(isHumanUserMessage(parsed)).toBe(false);
    expect(isTurnStartingUserMessage(parsed)).toBe(true);
  });
});
