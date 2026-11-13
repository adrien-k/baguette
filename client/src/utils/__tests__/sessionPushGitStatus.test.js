import { describe, expect, it } from 'vitest';
import {
  isSessionPushToolReadonly,
  shouldSkipSessionCommitsToPush,
} from '../sessionPushGitStatus.js';

describe('sessionPushGitStatus', () => {
  describe('shouldSkipSessionCommitsToPush', () => {
    it('skips when session is archiving or archived', () => {
      expect(shouldSkipSessionCommitsToPush({ id: 1, status: 'archiving' })).toBe(true);
      expect(shouldSkipSessionCommitsToPush({ id: 1, status: 'archived' })).toBe(true);
      expect(shouldSkipSessionCommitsToPush({ id: 1, archived_at: '2026-01-01' })).toBe(true);
    });

    it('polls for active repo sessions', () => {
      expect(shouldSkipSessionCommitsToPush({ id: 1, status: 'running' })).toBe(false);
    });
  });

  describe('isSessionPushToolReadonly', () => {
    it('is readonly while archiving or after archive', () => {
      expect(isSessionPushToolReadonly({ status: 'archiving' })).toBe(true);
      expect(isSessionPushToolReadonly({ status: 'archived' })).toBe(true);
      expect(isSessionPushToolReadonly({ archived_at: '2026-01-01', status: 'stopped' })).toBe(
        true
      );
    });

    it('allows push for active sessions', () => {
      expect(isSessionPushToolReadonly({ status: 'running' })).toBe(false);
    });
  });
});
