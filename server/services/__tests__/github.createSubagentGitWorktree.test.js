/**
 * createSubagentGitWorktree — stale linked worktrees must be recreated at the requested commit.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { createSubagentGitWorktree } from '../github.js';

const execAsync = promisify(execFile);
const git = (cwd, ...args) => execAsync('git', args, { cwd, stdio: 'pipe' });

const { TEST_DATA_DIR } = vi.hoisted(() => ({
  TEST_DATA_DIR: `/tmp/baguette-subagent-create-wt-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DATA_DIR: TEST_DATA_DIR,
    REPOS_DIR: `${TEST_DATA_DIR}/repos`,
    resolveDataDirRelativePath: (subpath) => {
      if (subpath == null || subpath === '') return subpath;
      if (path.isAbsolute(subpath)) return subpath;
      return path.join(TEST_DATA_DIR, subpath);
    },
    resolveRepoPath: (repo) => {
      if (!repo) return undefined;
      const stored = repo.repo_path;
      if (stored == null || stored === '') {
        return repo.stripped_name
          ? path.join(TEST_DATA_DIR, 'repos', repo.stripped_name, 'main')
          : undefined;
      }
      if (path.isAbsolute(stored)) return stored;
      return path.join(TEST_DATA_DIR, stored);
    },
  };
});

describe('createSubagentGitWorktree', () => {
  const STRIPPED = 'acme/subagent-wt';
  const SHORT_ID = 'stale01';
  let mainRepoPath;
  let sessionWorktreePath;
  let oldSha;
  let newSha;

  beforeAll(async () => {
    await fs.promises.mkdir(TEST_DATA_DIR, { recursive: true });
    const remotePath = path.join(TEST_DATA_DIR, 'remote.git');
    mainRepoPath = path.join(TEST_DATA_DIR, 'repos', STRIPPED, 'main');
    sessionWorktreePath = path.join(
      TEST_DATA_DIR,
      'repos',
      STRIPPED,
      'sessions',
      SHORT_ID,
      'worktree'
    );

    await execAsync('git', ['init', '--bare', remotePath], { stdio: 'pipe' });
    const workPath = path.join(TEST_DATA_DIR, 'seed-work');
    await execAsync('git', ['clone', remotePath, workPath], { stdio: 'pipe' });
    await git(workPath, 'config', 'user.email', 'test@test.com');
    await git(workPath, 'config', 'user.name', 'Test');
    await fs.promises.writeFile(path.join(workPath, 'README.md'), '# Test\n');
    await git(workPath, 'add', '.');
    await git(workPath, 'commit', '-m', 'init');
    await git(workPath, 'push', 'origin', 'HEAD:main');
    await execAsync('git', ['clone', '--bare', remotePath, mainRepoPath], { stdio: 'pipe' });

    await fs.promises.mkdir(path.dirname(sessionWorktreePath), { recursive: true });
    await execAsync('git', ['worktree', 'add', '--detach', sessionWorktreePath, 'main'], {
      cwd: mainRepoPath,
      stdio: 'pipe',
    });
    await git(sessionWorktreePath, 'config', 'user.email', 'test@test.com');
    await git(sessionWorktreePath, 'config', 'user.name', 'Test');
    const { stdout: firstHead } = await git(sessionWorktreePath, 'rev-parse', 'HEAD');
    oldSha = firstHead.trim();

    await fs.promises.writeFile(path.join(sessionWorktreePath, 'newer.txt'), 'new\n');
    await git(sessionWorktreePath, 'add', 'newer.txt');
    await git(sessionWorktreePath, 'commit', '-m', 'session advance');
    const { stdout: secondHead } = await git(sessionWorktreePath, 'rev-parse', 'HEAD');
    newSha = secondHead.trim();
    expect(newSha).not.toBe(oldSha);
  });

  afterAll(async () => {
    try {
      await fs.promises.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('recreates a linked worktree that is on the wrong commit', async () => {
    const branch = 'baguette/subagent/stale-test';
    const absolute = path.join(
      TEST_DATA_DIR,
      'repos',
      STRIPPED,
      'sessions',
      SHORT_ID,
      'sub-worktrees',
      'stale-test'
    );
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });

    await createSubagentGitWorktree(mainRepoPath, branch, absolute, oldSha);
    const { stdout: staleHead } = await git(absolute, 'rev-parse', 'HEAD');
    expect(staleHead.trim()).toBe(oldSha);

    await createSubagentGitWorktree(mainRepoPath, branch, absolute, newSha);
    const { stdout: freshHead } = await git(absolute, 'rev-parse', 'HEAD');
    expect(freshHead.trim()).toBe(newSha);
    const newer = await fs.promises.readFile(path.join(absolute, 'newer.txt'), 'utf8');
    expect(newer).toBe('new\n');
  });
});
