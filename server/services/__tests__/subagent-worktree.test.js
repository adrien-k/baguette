/**
 * Isolated subagent worktree helpers — real local git repos.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(execFile);
const git = (cwd, ...args) => execAsync('git', args, { cwd, stdio: 'pipe' });

const { TEST_DATA_DIR } = vi.hoisted(() => ({
  TEST_DATA_DIR: `/tmp/baguette-subagent-wt-${Math.random().toString(36).slice(2)}`,
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

import {
  subagentLocalBranchName,
  subagentWorktreeAbsolutePath,
  provisionIsolatedSubagentWorktree,
  teardownIsolatedSubagentWorktree,
  teardownSubagentWorktreesForSessionArchive,
  subagentWorktreePayload,
  assertIsolatedWorktreeAllowed,
  worktreePathForStorage,
  agentWorktreeCwd,
} from '../subagent-worktree.js';
import * as github from '../github.js';
import { createSubagentGitWorktree, deleteLocalGitBranchBestEffort } from '../github.js';

describe('subagent worktree helpers', () => {
  const STRIPPED = 'acme/widget';
  const SHORT_ID = 'abcd1234';
  let mainRepoPath;
  let sessionWorktreePath;
  let headSha;
  const repo = {
    stripped_name: STRIPPED,
    repo_path: `repos/${STRIPPED}/main`,
    full_name: 'acme/widget',
  };

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
    await fs.promises.writeFile(path.join(sessionWorktreePath, 'session-only.txt'), 'parent\n');
    await git(sessionWorktreePath, 'add', 'session-only.txt');
    await git(sessionWorktreePath, 'commit', '-m', 'session commit');
    const { stdout } = await git(sessionWorktreePath, 'rev-parse', 'HEAD');
    headSha = stdout.trim();
  });

  afterAll(async () => {
    try {
      await fs.promises.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('agentWorktreeCwd prefers isolated worktree_path', () => {
    const session = { session_path: worktreePathForStorage(sessionWorktreePath) };
    expect(agentWorktreeCwd(session, null)).toBe(sessionWorktreePath);
    const stored = worktreePathForStorage(subagentWorktreeAbsolutePath(session, repo, 7));
    expect(agentWorktreeCwd(session, { worktree_path: stored })).toBe(
      subagentWorktreeAbsolutePath(session, repo, 7)
    );
  });

  it('names branch and sibling path from agent id', () => {
    expect(subagentLocalBranchName(42)).toBe('baguette/subagent/42');
    const session = {
      session_path: path.relative(TEST_DATA_DIR, sessionWorktreePath).split(path.sep).join('/'),
      short_id: SHORT_ID,
    };
    const absolute = subagentWorktreeAbsolutePath(session, repo, 42);
    expect(absolute).toBe(
      path.join(TEST_DATA_DIR, 'repos', STRIPPED, 'sessions', SHORT_ID, 'sub-worktrees', '42')
    );
    expect(path.basename(path.dirname(absolute))).toBe('sub-worktrees');
    expect(absolute).not.toContain(`${path.sep}worktree${path.sep}sub-worktrees`);
  });

  it('rejects isolated worktree for global sessions', () => {
    expect(() => assertIsolatedWorktreeAllowed({ is_global: 1 })).toThrow(/global sessions/i);
  });

  it('provisions a worktree at session HEAD (committed snapshot only)', async () => {
    const agentId = 9001;
    const session = {
      session_path: worktreePathForStorage(sessionWorktreePath),
      short_id: SHORT_ID,
    };
    const meta = await provisionIsolatedSubagentWorktree(session, repo, agentId);
    expect(meta.local_branch).toBe(subagentLocalBranchName(agentId));
    expect(meta.worktree_path).toBe(subagentWorktreeAbsolutePath(session, repo, agentId));

    await expect(fs.promises.access(meta.worktree_path)).resolves.toBeUndefined();
    const { stdout: wtHead } = await git(meta.worktree_path, 'rev-parse', 'HEAD');
    expect(wtHead.trim()).toBe(headSha);
    const committed = await fs.promises.readFile(
      path.join(meta.worktree_path, 'session-only.txt'),
      'utf8'
    );
    expect(committed).toBe('parent\n');
    await fs.promises.writeFile(path.join(sessionWorktreePath, 'dirty.txt'), 'uncommitted\n');
    await expect(fs.promises.access(path.join(meta.worktree_path, 'dirty.txt'))).rejects.toThrow();
  });

  it('subagentWorktreePayload reflects stored row', () => {
    const stored = worktreePathForStorage(
      path.join(sessionWorktreePath, '..', 'sub-worktrees', '1')
    );
    const payload = subagentWorktreePayload({
      worktree_path: stored,
      local_branch: 'baguette/subagent/1',
    });
    expect(payload.isolated_worktree).toBe(true);
    expect(payload.local_branch).toBe('baguette/subagent/1');
    expect(payload.worktree_path).toContain('sub-worktrees');
    expect(subagentWorktreePayload({}).isolated_worktree).toBe(false);
    expect(subagentWorktreePayload({}).worktree_path).toBeNull();
  });

  it('teardown removes worktree registration and throwaway branch', async () => {
    const agentId = 9002;
    const session = {
      session_path: worktreePathForStorage(sessionWorktreePath),
      short_id: SHORT_ID,
    };
    const absolute = subagentWorktreeAbsolutePath(session, repo, agentId);
    const branch = subagentLocalBranchName(agentId);
    await createSubagentGitWorktree(mainRepoPath, branch, absolute, headSha);

    const stored = worktreePathForStorage(absolute);
    await teardownIsolatedSubagentWorktree(repo, {
      worktree_path: stored,
      local_branch: branch,
    });

    await expect(fs.promises.access(absolute)).rejects.toThrow();
    await expect(
      execAsync('git', ['rev-parse', '--verify', `refs/heads/${branch}`], {
        cwd: mainRepoPath,
        stdio: 'pipe',
      })
    ).rejects.toThrow();
  });

  it('deleteLocalGitBranchBestEffort is idempotent', async () => {
    await deleteLocalGitBranchBestEffort(mainRepoPath, 'baguette/subagent/no-such-branch');
  });

  it('session archive awaits sub-worktree task kill before removing worktrees', async () => {
    const agentId = 9010;
    const sessionId = 55;
    const session = {
      session_path: worktreePathForStorage(sessionWorktreePath),
      short_id: SHORT_ID,
    };
    const absolute = subagentWorktreeAbsolutePath(session, repo, agentId);
    const branch = subagentLocalBranchName(agentId);
    await createSubagentGitWorktree(mainRepoPath, branch, absolute, headSha);
    const stored = worktreePathForStorage(absolute);

    const teardownEvents = [];
    let resolveSubKill;
    const subKillStarted = new Promise((resolve) => {
      resolveSubKill = resolve;
    });
    const parentTask = {
      session_id: sessionId,
      status: 'running',
      _cwd: sessionWorktreePath,
      kill: vi.fn().mockResolvedValue(true),
    };
    const subTask = {
      session_id: sessionId,
      status: 'running',
      _cwd: absolute,
      kill: vi.fn(() => {
        teardownEvents.push('sub-kill-start');
        return subKillStarted.then(() => {
          teardownEvents.push('sub-kill-done');
          return true;
        });
      }),
    };
    const tasks = new Map([
      [1, parentTask],
      [2, subTask],
    ]);
    const agentRows = [{ id: agentId, worktree_path: stored, local_branch: branch }];
    const db = () => ({
      where: () => ({
        whereNotNull: () => ({
          select: async () => agentRows,
        }),
      }),
    });
    const app = {
      get: (key) => (key === 'db' ? db : undefined),
      service: () => ({ _tasks: tasks }),
    };

    const removeSpy = vi.spyOn(github, 'removeSubagentGitWorktree').mockImplementation(async () => {
      teardownEvents.push('worktree-remove');
    });

    const archivePromise = teardownSubagentWorktreesForSessionArchive(
      app,
      sessionId,
      session,
      repo
    );

    await vi.waitFor(() => {
      expect(teardownEvents).toContain('sub-kill-start');
    });
    expect(teardownEvents).not.toContain('worktree-remove');
    expect(parentTask.kill).not.toHaveBeenCalled();

    resolveSubKill();
    await archivePromise;

    expect(subTask.kill).toHaveBeenCalled();
    expect(teardownEvents.indexOf('sub-kill-done')).toBeLessThan(
      teardownEvents.indexOf('worktree-remove')
    );
    removeSpy.mockRestore();
    await teardownIsolatedSubagentWorktree(repo, {
      worktree_path: stored,
      local_branch: branch,
    });
  });
});
