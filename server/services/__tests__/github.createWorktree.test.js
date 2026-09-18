/**
 * Integration test for createWorktree using real local git repos.
 *
 * Covers two behaviours:
 *
 * 1. "Refusing to fetch into branch checked out" regression:
 *    When two sessions share the same base branch, the second createWorktree call used to fail
 *    at the fetch step because `+branch:branch` tried to update refs/heads/<branch> while
 *    another worktree had it checked out. The fix fetches to a session-unique temp ref instead.
 *
 * 2. Worktrees start from the latest remote commit:
 *    The bare clone's local branch ref can be stale (it was set at clone time and never updated
 *    by subsequent remote pushes). The fix syncs refs/heads/<branch> via git update-ref after
 *    every fetch so new worktrees always start at the current remote HEAD.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(execFile);
const git = (cwd, ...args) => execAsync('git', args, { cwd, stdio: 'pipe' });

// Must be created before vi.mock runs (vi.hoisted executes before imports)
const { TEST_REPOS_DIR } = vi.hoisted(() => ({
  TEST_REPOS_DIR: `/tmp/baguette-git-test-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('../config.js', () => ({
  REPOS_DIR: TEST_REPOS_DIR,
  resolveDataDirRelativePath: (subpath) => `${TEST_REPOS_DIR}/${subpath}`,
}));

import { createWorktree } from '../github.js';

describe('createWorktree', () => {
  const BRANCH = 'feature-branch-a';
  // Local repos don't use HTTP auth, so any string works as the token
  const FAKE_TOKEN = 'fake-token';
  let barePath;

  beforeAll(async () => {
    await fs.promises.mkdir(TEST_REPOS_DIR, { recursive: true });

    const remotePath = path.join(TEST_REPOS_DIR, 'remote.git');
    barePath = path.join(TEST_REPOS_DIR, 'bare.git');

    // Bare "remote" repo — simulates GitHub
    await execAsync('git', ['init', '--bare', remotePath], { stdio: 'pipe' });

    // Working clone to author commits
    const workPath = path.join(TEST_REPOS_DIR, 'work');
    await execAsync('git', ['clone', remotePath, workPath], { stdio: 'pipe' });
    await git(workPath, 'config', 'user.email', 'test@test.com');
    await git(workPath, 'config', 'user.name', 'Test');

    // Initial commit on the default branch
    await fs.promises.writeFile(path.join(workPath, 'README.md'), '# Test\n');
    await git(workPath, 'add', '.');
    await git(workPath, 'commit', '-m', 'init');
    await git(workPath, 'push', 'origin', 'HEAD');

    // Create and push the branch that sessions will be based on
    await git(workPath, 'checkout', '-b', BRANCH);
    await fs.promises.writeFile(path.join(workPath, 'feature.txt'), 'feat\n');
    await git(workPath, 'add', '.');
    await git(workPath, 'commit', '-m', 'add feature');
    await git(workPath, 'push', 'origin', BRANCH);

    // Baguette's bare clone of the remote
    await execAsync('git', ['clone', '--bare', remotePath, barePath], { stdio: 'pipe' });
  });

  afterAll(async () => {
    await fs.promises.rm(TEST_REPOS_DIR, { recursive: true, force: true });
  });

  it('allows creating a second session worktree for a branch already checked out in another worktree', async () => {
    const repo = { bare_path: barePath, stripped_name: 'test-org/test-repo' };

    // Session 1: continueExistingBranch-style — checks out BRANCH non-detached.
    // After this, refs/heads/BRANCH is owned by session-1's worktree.
    await createWorktree(repo, BRANCH, 'session-1', FAKE_TOKEN, { detach: false });

    // Session 2: new session based on the same branch (default detach: true).
    // The fetch goes to a unique temp ref, so git never sees a "branch checked out" conflict.
    await expect(createWorktree(repo, BRANCH, 'session-2', FAKE_TOKEN)).resolves.toMatchObject({
      worktreePath: expect.stringContaining('session-2'),
    });
  });

  it('worktree starts from the latest remote commit, not the stale bare-clone ref', async () => {
    const workPath = path.join(TEST_REPOS_DIR, 'work');
    const remotePath = path.join(TEST_REPOS_DIR, 'remote.git');

    // Push a new commit to the remote AFTER the bare clone was created
    await fs.promises.writeFile(path.join(workPath, 'update.txt'), 'updated\n');
    await git(workPath, 'add', '.');
    await git(workPath, 'commit', '-m', 'post-clone update');
    await git(workPath, 'push', 'origin', BRANCH);

    // Capture the new HEAD SHA from the remote
    const { stdout: remoteHead } = await git(remotePath, 'rev-parse', BRANCH);
    const expectedSha = remoteHead.trim();

    const repo = { bare_path: barePath, stripped_name: 'test-org/test-repo' };
    const { worktreePath } = await createWorktree(repo, BRANCH, 'session-latest', FAKE_TOKEN);

    // The local branch ref in the bare repo should be updated to the latest remote commit
    const { stdout: bareHead } = await git(barePath, 'rev-parse', BRANCH);
    expect(bareHead.trim()).toBe(expectedSha);

    // The worktree directory should contain files from the new commit
    const files = await fs.promises.readdir(worktreePath);
    expect(files).toContain('update.txt');
  });
});
