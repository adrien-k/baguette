import { describe, it, expect } from 'vitest';
import {
  LIST_SCOPE_ALL,
  LIST_SCOPE_MINE,
  LIST_SCOPE_SHARED,
  isSessionOwner,
  normalizeListScope,
  ownerPublicFields,
} from '../session-sharing.js';

describe('session-sharing', () => {
  it('normalizes list_scope', () => {
    expect(normalizeListScope('shared')).toBe(LIST_SCOPE_SHARED);
    expect(normalizeListScope('1')).toBe(LIST_SCOPE_SHARED);
    expect(normalizeListScope('all')).toBe(LIST_SCOPE_ALL);
    expect(normalizeListScope('accessible')).toBe(LIST_SCOPE_ALL);
    expect(normalizeListScope(undefined)).toBe(LIST_SCOPE_MINE);
    expect(normalizeListScope('mine')).toBe(LIST_SCOPE_MINE);
  });

  it('compares session owner by user id', () => {
    expect(isSessionOwner({ user_id: 3 }, { id: 3 })).toBe(true);
    expect(isSessionOwner({ user_id: 3 }, 3)).toBe(true);
    expect(isSessionOwner({ user_id: 3 }, { id: 4 })).toBe(false);
    expect(isSessionOwner(null, { id: 3 })).toBe(false);
  });

  it('returns public owner fields only', () => {
    expect(
      ownerPublicFields({
        id: 1,
        username: 'alice',
        avatar_url: 'https://x',
        access_token: 'secret',
      })
    ).toEqual({ id: 1, username: 'alice', avatar_url: 'https://x' });
    expect(ownerPublicFields(null)).toBeNull();
  });
});
