import { describe, expect, it } from 'vitest';
import {
  boundScopeLoading,
  boundScopeValue,
  isBoundScope,
  rowsForSession,
  sameScopeId,
  scopeKeyOf,
} from '../boundScope.js';

describe('scopeKeyOf', () => {
  it('joins parts and treats nullish as empty', () => {
    expect(scopeKeyOf(12, 34)).toBe('12\x0034');
    expect(scopeKeyOf(12, null)).toBe('12\x00');
    expect(scopeKeyOf(null, 1)).toBe('\x001');
  });
});

describe('sameScopeId', () => {
  it('matches string and number ids', () => {
    expect(sameScopeId(7, '7')).toBe(true);
    expect(sameScopeId(7, 8)).toBe(false);
    expect(sameScopeId(null, undefined)).toBe(true);
    expect(sameScopeId(1, null)).toBe(false);
  });
});

describe('boundScopeValue / loading', () => {
  it('hides data and reports loading when the loaded key does not match', () => {
    const messages = [{ id: 1, session_id: 1 }];
    expect(isBoundScope('2', '1')).toBe(false);
    expect(boundScopeValue('2', '1', messages, [])).toEqual([]);
    expect(boundScopeLoading('2', '1', false)).toBe(true);
  });

  it('returns data once the loaded key matches and the request is idle', () => {
    const messages = [{ id: 1, session_id: 2 }];
    expect(boundScopeValue('2', '2', messages, [])).toBe(messages);
    expect(boundScopeLoading('2', '2', false)).toBe(false);
    expect(boundScopeLoading('2', '2', true)).toBe(true);
  });

  it('does not load when nothing is requested', () => {
    expect(boundScopeLoading('', '1', false)).toBe(false);
    expect(boundScopeValue('', '1', [{ id: 1 }], [])).toEqual([]);
  });
});

describe('rowsForSession', () => {
  const rows = [
    { id: 1, session_id: 10, agent_id: 1 },
    { id: 2, session_id: '10', agent_id: 2 },
    { id: 3, session_id: 11, agent_id: 1 },
  ];

  it('drops rows from other sessions', () => {
    expect(rowsForSession(rows, 10).map((r) => r.id)).toEqual([1, 2]);
  });

  it('applies an extra match (agent) after the session filter', () => {
    expect(
      rowsForSession(rows, 10, (row) => sameScopeId(row.agent_id, 1)).map((r) => r.id)
    ).toEqual([1]);
  });

  it('returns empty when session id is missing', () => {
    expect(rowsForSession(rows, null)).toEqual([]);
  });
});
