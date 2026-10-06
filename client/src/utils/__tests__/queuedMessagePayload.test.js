import { describe, it, expect } from 'vitest';
import {
  readQueuedMessageText,
  queuedMessageHasAttachments,
  rebuildQueuedMessageJson,
} from '../queuedMessagePayload.js';

const typed = (content) => JSON.stringify({ type: 'user', content });
const legacyString = (content) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content } });
const legacyBlocks = (blocks) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: blocks } });

const IMAGE = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } };

describe('readQueuedMessageText', () => {
  it('reads the typed payload written by normalizeUserPayloadForStorage', () => {
    expect(readQueuedMessageText(typed('do the thing'))).toBe('do the thing');
  });

  it('reads a legacy string envelope', () => {
    expect(readQueuedMessageText(legacyString('do the thing'))).toBe('do the thing');
  });

  it('joins multiple legacy text blocks', () => {
    const json = legacyBlocks([
      { type: 'text', text: 'first' },
      IMAGE,
      { type: 'text', text: 'second' },
    ]);
    expect(readQueuedMessageText(json)).toBe('first\n\nsecond');
  });

  it('returns empty string for unparseable payloads', () => {
    expect(readQueuedMessageText('not json')).toBe('');
    expect(readQueuedMessageText(JSON.stringify({ type: 'user' }))).toBe('');
  });
});

describe('queuedMessageHasAttachments', () => {
  it('detects non-text blocks in a legacy envelope', () => {
    expect(queuedMessageHasAttachments(legacyBlocks([{ type: 'text', text: 'hi' }, IMAGE]))).toBe(
      true
    );
  });

  it('is false for text-only payloads in either shape', () => {
    expect(queuedMessageHasAttachments(typed('hi'))).toBe(false);
    expect(queuedMessageHasAttachments(legacyString('hi'))).toBe(false);
    expect(queuedMessageHasAttachments(legacyBlocks([{ type: 'text', text: 'hi' }]))).toBe(false);
  });
});

describe('rebuildQueuedMessageJson', () => {
  it('rewrites content in place on a typed payload and keeps the envelope typed', () => {
    const rebuilt = JSON.parse(rebuildQueuedMessageJson(typed('old'), 'new'));
    expect(rebuilt).toEqual({ type: 'user', content: 'new' });
  });

  it('preserves other typed payload fields', () => {
    const json = JSON.stringify({ type: 'user', content: 'old', source: 'baguette' });
    const rebuilt = JSON.parse(rebuildQueuedMessageJson(json, 'new'));
    expect(rebuilt).toEqual({ type: 'user', content: 'new', source: 'baguette' });
  });

  it('keeps a legacy string envelope as a string', () => {
    const rebuilt = JSON.parse(rebuildQueuedMessageJson(legacyString('old'), 'new'));
    expect(rebuilt).toEqual({ type: 'user', message: { role: 'user', content: 'new' } });
  });

  it('preserves attachment blocks and drops empty text', () => {
    const rebuilt = JSON.parse(
      rebuildQueuedMessageJson(legacyBlocks([{ type: 'text', text: 'old' }, IMAGE]), 'new')
    );
    expect(rebuilt.message.content).toEqual([{ type: 'text', text: 'new' }, IMAGE]);
  });

  it('keeps only attachment blocks when the text is cleared', () => {
    const rebuilt = JSON.parse(
      rebuildQueuedMessageJson(legacyBlocks([{ type: 'text', text: 'old' }, IMAGE]), '')
    );
    expect(rebuilt.message.content).toEqual([IMAGE]);
  });

  it('does not accumulate text blocks across repeated edits', () => {
    const once = rebuildQueuedMessageJson(legacyBlocks([{ type: 'text', text: 'a' }]), 'b');
    const twice = rebuildQueuedMessageJson(once, 'c');
    expect(JSON.parse(twice).message.content).toEqual([{ type: 'text', text: 'c' }]);
  });

  it('returns the input unchanged when the payload cannot be parsed', () => {
    expect(rebuildQueuedMessageJson('not json', 'new')).toBe('not json');
  });
});
