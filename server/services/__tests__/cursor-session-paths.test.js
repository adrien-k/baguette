import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { cursorSessionDataDir, cursorSdkStateRoot } from '../cursor/cursor-session-paths.js';
import { REPOS_DIR } from '../../config.js';
import { toStrippedName } from '../github.js';

describe('cursor-session-paths', () => {
  it('resolves the session folder from a worktree path', () => {
    const worktree = path.join(
      REPOS_DIR,
      toStrippedName('org/repo'),
      'sessions',
      'abc123',
      'worktree'
    );
    const sessionDir = cursorSessionDataDir({ session_path: worktree });
    expect(sessionDir).toBe(path.join(REPOS_DIR, toStrippedName('org/repo'), 'sessions', 'abc123'));
    expect(cursorSdkStateRoot({ session_path: worktree })).toBe(
      path.join(sessionDir, 'cursor-sdk-store')
    );
  });

  it('resolves the session folder from repo + short_id before the worktree exists', () => {
    const session = { repo_full_name: 'org/repo', short_id: 'xyz789' };
    expect(cursorSessionDataDir(session)).toBe(
      path.join(REPOS_DIR, toStrippedName('org/repo'), 'sessions', 'xyz789')
    );
  });
});
