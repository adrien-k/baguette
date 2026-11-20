import { describe, expect, it } from 'vitest';
import {
  applyMessageEventToInfiniteMessages,
  messageEventMatchesKey,
} from '../messageCacheUpdaters.js';

function infiniteMessages(rowsPerPage) {
  return {
    pages: rowsPerPage.map((rows) => rows),
    pageParams: rowsPerPage.map((_, i) => (i === 0 ? null : 100 - i * 100)),
  };
}

describe('messageEventMatchesKey', () => {
  it('matches session-scope entries for any agent', () => {
    expect(messageEventMatchesKey('5', null, { id: 1, session_id: 5, agent_id: 2 })).toBe(true);
  });

  it('restricts agent-scoped entries to that agent', () => {
    expect(messageEventMatchesKey('5', '2', { id: 1, session_id: 5, agent_id: 2 })).toBe(true);
    expect(messageEventMatchesKey('5', '3', { id: 1, session_id: 5, agent_id: 2 })).toBe(false);
    expect(messageEventMatchesKey('5', '2', { id: 1, session_id: 5, agent_id: null })).toBe(false);
  });

  it('rejects other sessions and empty messages', () => {
    expect(messageEventMatchesKey('5', null, { id: 1, session_id: 6 })).toBe(false);
    expect(messageEventMatchesKey('5', null, null)).toBe(false);
  });
});

describe('applyMessageEventToInfiniteMessages', () => {
  it('inserts into id-sorted position across pages', () => {
    const data = infiniteMessages([[{ id: 1, text: 'a' }], [{ id: 101, text: 'b' }]]);
    const next = applyMessageEventToInfiniteMessages(data, { id: 2, text: 'new' });
    expect(next.pages[0]).toEqual([
      { id: 1, text: 'a' },
      { id: 2, text: 'new' },
    ]);
    expect(next.pages[1]).toEqual([{ id: 101, text: 'b' }]);
  });

  it('replaces an existing message by id', () => {
    const data = infiniteMessages([[{ id: 1, text: 'a' }]]);
    const next = applyMessageEventToInfiniteMessages(data, { id: 1, text: 'patched' });
    expect(next.pages[0]).toEqual([{ id: 1, text: 'patched' }]);
  });

  it('leaves the cache alone for unknown ids below the loaded window', () => {
    const data = infiniteMessages([[{ id: 1, text: 'a' }]]);
    expect(applyMessageEventToInfiniteMessages(data, { id: 0, text: 'old' })).toBe(data);
  });
});
