import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  DATA_DIR,
  normalizeRepoPathForStorage,
  resolveRepoPath,
  storedRepoPath,
} from '../../config.js';

describe('repo path storage', () => {
  it('storedRepoPath uses posix segments', () => {
    expect(storedRepoPath('adrien-k-pg-app')).toBe('repos/adrien-k-pg-app/main');
  });

  it('resolveRepoPath joins relative paths with DATA_DIR', () => {
    const repo = { stripped_name: 'foo', repo_path: 'repos/foo/main' };
    expect(resolveRepoPath(repo)).toBe(path.join(DATA_DIR, 'repos/foo/main'));
  });

  it('resolveRepoPath still accepts legacy absolute paths', () => {
    const abs = path.join(DATA_DIR, 'repos', 'foo', 'main');
    expect(resolveRepoPath({ stripped_name: 'foo', repo_path: abs })).toBe(abs);
  });

  it('normalizeRepoPathForStorage strips DATA_DIR prefix', () => {
    const abs = path.join(DATA_DIR, 'repos', 'my-repo', 'main');
    expect(normalizeRepoPathForStorage(abs, 'my-repo')).toBe('repos/my-repo/main');
  });

  it('normalizeRepoPathForStorage strips foreign absolute prefix when suffix matches', () => {
    const foreign = '/tmp/shared/dev-data-dir/repos/my-repo/main';
    expect(normalizeRepoPathForStorage(foreign, 'my-repo')).toBe('repos/my-repo/main');
  });
});
