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

vi.mock('../../config.js', () => ({
  REPOS_DIR: TEST_REPOS_DIR,
  resolveDataDirRelativePath: (subpath) => {
    if (subpath == null || subpath === '') return subpath;
    return `${TEST_REPOS_DIR}/${subpath}`;
  },
}));

import {
  createWorktree,
  uniqueLocalBranch,
  removeWorktree,
  gitLogSinceBase,
  isMissingRemoteRefError,
} from '../github.js';

describe('isMissingRemoteRefError', () => {
  it('detects missing remote branch ref errors from git fetch', () => {
    expect(
      isMissingRemoteRefError({
        stderr: "fatal: couldn't find remote ref feature/unpublished\n",
      })
    ).toBe(true);
    expect(isMissingRemoteRefError({ stderr: 'fatal: No such remote: origin\n' })).toBe(true);
    expect(isMissingRemoteRefError({ stderr: 'fatal: authentication failed\n' })).toBe(false);
  });
});

describe('uniqueLocalBranch', () => {
  it('appends short_id when the intended name does not already include it', () => {
    expect(uniqueLocalBranch('feature/foo', 'abcd1234')).toBe('feature/foo-abcd1234');
  });

  it('leaves the name unchanged when it already ends with -shortId', () => {
    expect(uniqueLocalBranch('feature/foo-abcd1234', 'abcd1234')).toBe('feature/foo-abcd1234');
  });
});

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

  it('creates two unique local branches tracking the same start branch', async () => {
    const repo = { bare_path: barePath, stripped_name: 'test-org/test-repo' };

    const first = await createWorktree(repo, BRANCH, 'wt-local-1', FAKE_TOKEN, {
      localBranch: `${BRANCH}-aaaa`,
    });
    const { stdout: headA } = await git(first.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD');
    expect(headA.trim()).toBe(`${BRANCH}-aaaa`);

    const second = await createWorktree(repo, BRANCH, 'wt-local-2', FAKE_TOKEN, {
      localBranch: `${BRANCH}-bbbb`,
    });
    const { stdout: headB } = await git(second.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD');
    expect(headB.trim()).toBe(`${BRANCH}-bbbb`);
  });

  it('creates a worktree when the branch exists only locally (never pushed to origin)', async () => {
    const UNPUBLISHED = 'feature/unpublished-local';
    const workPath = path.join(TEST_REPOS_DIR, 'work');
    await git(workPath, 'checkout', '-b', UNPUBLISHED);
    await fs.promises.writeFile(path.join(workPath, 'local-only.txt'), 'local\n');
    await git(workPath, 'add', '.');
    await git(workPath, 'commit', '-m', 'local only');
    const { stdout: localHead } = await git(workPath, 'rev-parse', 'HEAD');
    await execAsync('git', ['-C', barePath, 'fetch', workPath, `+${UNPUBLISHED}:${UNPUBLISHED}`], {
      stdio: 'pipe',
    });

    const repo = { bare_path: barePath, stripped_name: 'test-org/test-repo' };
    const { worktreePath } = await createWorktree(
      repo,
      UNPUBLISHED,
      'session-unpublished',
      FAKE_TOKEN
    );

    const { stdout: bareHead } = await git(barePath, 'rev-parse', UNPUBLISHED);
    expect(bareHead.trim()).toBe(localHead.trim());
    const files = await fs.promises.readdir(worktreePath);
    expect(files).toContain('local-only.txt');
  });

  it('worktree starts from the latest remote commit, not the stale bare-clone ref', async () => {
    const workPath = path.join(TEST_REPOS_DIR, 'work');
    const remotePath = path.join(TEST_REPOS_DIR, 'remote.git');

    await git(workPath, 'checkout', BRANCH);

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

  it('deletes a unique local branch after removing the worktree', async () => {
    const repo = { bare_path: barePath, stripped_name: 'test-org/test-repo' };
    const localBranch = `${BRANCH}-archive`;
    await createWorktree(repo, BRANCH, 'wt-archive-1', FAKE_TOKEN, { localBranch });

    const { stdout: before } = await git(barePath, 'branch', '--list', localBranch);
    expect(before.trim()).toContain(localBranch);

    await removeWorktree(
      {
        short_id: 'wt-archive-1',
        local_branch: localBranch,
        remote_branch: BRANCH,
      },
      repo
    );

    const { stdout: after } = await git(barePath, 'branch', '--list', localBranch);
    expect(after.trim()).toBe('');
    const { stdout: shared } = await git(barePath, 'branch', '--list', BRANCH);
    expect(shared.trim()).toContain(BRANCH);
  });

  it('does not delete local_branch when it matches remote_branch', async () => {
    const repo = { bare_path: barePath, stripped_name: 'test-org/test-repo' };
    // session-1 from an earlier test may still have BRANCH checked out in its worktree.
    await removeWorktree(
      { short_id: 'session-1', local_branch: BRANCH, remote_branch: BRANCH },
      repo
    );
    await createWorktree(repo, BRANCH, 'wt-legacy-1', FAKE_TOKEN, { detach: false });

    await removeWorktree(
      {
        short_id: 'wt-legacy-1',
        local_branch: BRANCH,
        remote_branch: BRANCH,
      },
      repo
    );

    const { stdout: shared } = await git(barePath, 'branch', '--list', BRANCH);
    expect(shared.trim()).toContain(BRANCH);
  });

  it('does not fail archive when the unique local branch is already gone', async () => {
    const repo = { bare_path: barePath, stripped_name: 'test-org/test-repo' };
    await expect(
      removeWorktree(
        {
          short_id: 'missing-wt',
          local_branch: `${BRANCH}-already-gone`,
          remote_branch: BRANCH,
        },
        repo
      )
    ).resolves.toBeUndefined();
  });

  it('gitLogSinceBase lists commits since merge-base with the base branch', async () => {
    const workPath = path.join(TEST_REPOS_DIR, 'work');
    let baseBranch = 'main';
    try {
      await execAsync('git', ['-C', workPath, 'rev-parse', '--verify', 'main'], { stdio: 'pipe' });
    } catch {
      baseBranch = 'master';
    }
    await execAsync('git', ['-C', workPath, 'checkout', BRANCH], { stdio: 'pipe' });
    const commits = await gitLogSinceBase(workPath, baseBranch);
    expect(commits.length).toBeGreaterThanOrEqual(1);
    expect(commits.every((c) => c.sha && c.short_sha)).toBe(true);
    expect(commits[0]).toMatchObject({
      sha: expect.any(String),
      short_sha: expect.any(String),
      subject: expect.any(String),
    });
  });
});
