import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { gitMergeSessionIntoBase } from '../github.js';

const execAsync = promisify(execFile);
const git = (cwd, ...args) => execAsync('git', args, { cwd, stdio: 'pipe' });

describe('gitMergeSessionIntoBase', () => {
  const TEST_DIR = `/tmp/baguette-local-merge-${Math.random().toString(36).slice(2)}`;
  const MAIN_REPO = path.join(TEST_DIR, 'main');
  const SESSION_WT = path.join(TEST_DIR, 'session-wt');
  const BASE = 'main';
  const LOCAL = 'main-session1';

  beforeAll(async () => {
    await fs.promises.mkdir(TEST_DIR, { recursive: true });
    await execAsync('git', ['init', '-b', BASE, MAIN_REPO], { stdio: 'pipe' });
    await git(MAIN_REPO, 'config', 'user.email', 'test@test.com');
    await git(MAIN_REPO, 'config', 'user.name', 'Test');
    await fs.promises.writeFile(path.join(MAIN_REPO, 'README.md'), 'base\n');
    await git(MAIN_REPO, 'add', '.');
    await git(MAIN_REPO, 'commit', '-m', 'base');

    await execAsync('git', ['-C', MAIN_REPO, 'worktree', 'add', '-B', LOCAL, SESSION_WT, BASE], {
      stdio: 'pipe',
    });
    await git(SESSION_WT, 'config', 'user.email', 'test@test.com');
    await git(SESSION_WT, 'config', 'user.name', 'Test');
    await fs.promises.writeFile(path.join(SESSION_WT, 'feature.txt'), 'work\n');
    await git(SESSION_WT, 'add', '.');
    await git(SESSION_WT, 'commit', '-m', 'session work');
  });

  afterAll(async () => {
    await execAsync('git', ['-C', MAIN_REPO, 'worktree', 'remove', '--force', SESSION_WT], {
      stdio: 'pipe',
    }).catch(() => {});
    await fs.promises.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('merges the session branch into the base branch in the main clone', async () => {
    await gitMergeSessionIntoBase({
      worktreePath: SESSION_WT,
      mainRepoPath: MAIN_REPO,
      baseBranch: BASE,
      sourceBranch: LOCAL,
    });

    const { stdout: mainLog } = await git(MAIN_REPO, 'log', '--oneline', '-5');
    expect(mainLog).toContain('session work');
    const { stdout: tip } = await git(MAIN_REPO, 'show', '-s', '--format=%s', 'HEAD');
    expect(tip.trim()).toBe('session work');
  });

  it('merges in the existing worktree when base is checked out elsewhere', async () => {
    const extraDir = `/tmp/baguette-local-merge-extra-${Math.random().toString(36).slice(2)}`;
    const mainClone = path.join(extraDir, 'main');
    const baseWt = path.join(extraDir, 'base-wt');
    const featWt = path.join(extraDir, 'feat-wt');
    try {
      await fs.promises.mkdir(extraDir, { recursive: true });
      await execAsync('git', ['init', '-b', BASE, mainClone], { stdio: 'pipe' });
      await git(mainClone, 'config', 'user.email', 'test@test.com');
      await git(mainClone, 'config', 'user.name', 'Test');
      await fs.promises.writeFile(path.join(mainClone, 'README.md'), 'base\n');
      await git(mainClone, 'add', '.');
      await git(mainClone, 'commit', '-m', 'base');

      const { stdout: rootSha } = await git(mainClone, 'rev-parse', 'HEAD');
      await git(mainClone, 'checkout', '--detach', rootSha.trim());
      await execAsync(
        'git',
        ['-C', mainClone, 'worktree', 'add', '-B', BASE, baseWt, rootSha.trim()],
        { stdio: 'pipe' }
      );
      await git(mainClone, 'checkout', '-b', 'develop');

      await execAsync(
        'git',
        ['-C', mainClone, 'worktree', 'add', '-b', 'feat-session', featWt, 'develop'],
        { stdio: 'pipe' }
      );
      await git(featWt, 'config', 'user.email', 'test@test.com');
      await git(featWt, 'config', 'user.name', 'Test');
      await fs.promises.writeFile(path.join(featWt, 'feature.txt'), 'feat\n');
      await git(featWt, 'add', '.');
      await git(featWt, 'commit', '-m', 'feature work');

      await gitMergeSessionIntoBase({
        worktreePath: featWt,
        mainRepoPath: mainClone,
        baseBranch: BASE,
        sourceBranch: 'feat-session',
      });

      const { stdout: mainTip } = await git(baseWt, 'show', '-s', '--format=%s', 'HEAD');
      expect(mainTip.trim()).toBe('feature work');
    } finally {
      await execAsync('git', ['-C', mainClone, 'worktree', 'remove', '--force', featWt], {
        stdio: 'pipe',
      }).catch(() => {});
      await execAsync('git', ['-C', mainClone, 'worktree', 'remove', '--force', baseWt], {
        stdio: 'pipe',
      }).catch(() => {});
      await fs.promises.rm(extraDir, { recursive: true, force: true });
    }
  });

  it('does not move baseBranch backward when sourceBranch equals baseBranch', async () => {
    const extraDir = `/tmp/baguette-local-merge-same-${Math.random().toString(36).slice(2)}`;
    const mainClone = path.join(extraDir, 'main');
    const sessionWt = path.join(extraDir, 'session-wt');
    try {
      await fs.promises.mkdir(extraDir, { recursive: true });
      await execAsync('git', ['init', '-b', BASE, mainClone], { stdio: 'pipe' });
      await git(mainClone, 'config', 'user.email', 'test@test.com');
      await git(mainClone, 'config', 'user.name', 'Test');
      await fs.promises.writeFile(path.join(mainClone, 'README.md'), 'base\n');
      await git(mainClone, 'add', '.');
      await git(mainClone, 'commit', '-m', 'base');

      await fs.promises.writeFile(path.join(mainClone, 'only-on-main.txt'), 'main-only\n');
      await git(mainClone, 'add', '.');
      await git(mainClone, 'commit', '-m', 'main-only');

      const { stdout: mainOnlySha } = await git(mainClone, 'rev-parse', 'HEAD');
      const { stdout: baseSha } = await git(mainClone, 'rev-parse', `${mainOnlySha.trim()}^`);
      await git(mainClone, 'checkout', '--detach', mainOnlySha.trim());

      await execAsync(
        'git',
        ['-C', mainClone, 'worktree', 'add', '-B', BASE, sessionWt, baseSha.trim()],
        { stdio: 'pipe' }
      );
      await git(sessionWt, 'config', 'user.email', 'test@test.com');
      await git(sessionWt, 'config', 'user.name', 'Test');

      await gitMergeSessionIntoBase({
        worktreePath: sessionWt,
        mainRepoPath: mainClone,
        baseBranch: BASE,
        sourceBranch: BASE,
      });

      const { stdout: mainHead } = await git(mainClone, 'rev-parse', 'HEAD');
      expect(mainHead.trim()).toBe(mainOnlySha.trim());
    } finally {
      await execAsync('git', ['-C', mainClone, 'worktree', 'remove', '--force', sessionWt], {
        stdio: 'pipe',
      }).catch(() => {});
      await fs.promises.rm(extraDir, { recursive: true, force: true });
    }
  });
});
