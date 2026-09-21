import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  gitIdentityFromUser,
  gitAuthorEnvFromUser,
  configureWorktreeGitIdentity,
} from '../git-identity.js';

const execAsync = promisify(execFile);
const git = (cwd, ...args) => execAsync('git', args, { cwd, stdio: 'pipe' });

describe('gitIdentityFromUser', () => {
  it('uses username and stored email when present', () => {
    expect(gitIdentityFromUser({ username: 'alice', email: 'alice@example.com' })).toEqual({
      name: 'alice',
      email: 'alice@example.com',
    });
  });

  it('uses a GitHub noreply address when email is missing', () => {
    expect(gitIdentityFromUser({ username: 'bob', github_id: 12345 })).toEqual({
      name: 'bob',
      email: '12345+bob@users.noreply.github.com',
    });
  });

  it('falls back to baguette when the user is missing', () => {
    expect(gitIdentityFromUser(null)).toEqual({
      name: 'baguette',
      email: 'baguette@users.noreply.github.com',
    });
  });
});

describe('gitAuthorEnvFromUser', () => {
  it('sets author and committer env vars', () => {
    expect(gitAuthorEnvFromUser({ username: 'alice', email: 'alice@example.com' })).toEqual({
      GIT_AUTHOR_NAME: 'alice',
      GIT_AUTHOR_EMAIL: 'alice@example.com',
      GIT_COMMITTER_NAME: 'alice',
      GIT_COMMITTER_EMAIL: 'alice@example.com',
    });
  });
});

describe('configureWorktreeGitIdentity', () => {
  let tmpRoot;
  let repoPath;
  let worktreeA;
  let worktreeB;

  beforeAll(async () => {
    tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'baguette-git-identity-'));
    repoPath = path.join(tmpRoot, 'repo');
    worktreeA = path.join(tmpRoot, 'session-a');
    worktreeB = path.join(tmpRoot, 'session-b');

    await execAsync('git', ['init', repoPath], { stdio: 'pipe' });
    await git(repoPath, 'config', 'user.email', 'setup@test.com');
    await git(repoPath, 'config', 'user.name', 'Setup');
    await git(repoPath, 'commit', '--allow-empty', '-m', 'init');
    await git(repoPath, 'worktree', 'add', '--detach', worktreeA);
    await git(repoPath, 'worktree', 'add', '--detach', worktreeB);
  });

  afterAll(async () => {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  });

  async function commitAsConfigured(worktreePath, filename) {
    await fs.promises.writeFile(path.join(worktreePath, filename), 'ok\n');
    await git(worktreePath, 'add', filename);
    await git(worktreePath, 'commit', '-m', `add ${filename}`);
    const { stdout } = await git(worktreePath, 'log', '-1', '--format=%an <%ae>');
    return stdout.trim();
  }

  it('keeps per-session identity so a later session does not rewrite earlier commits', async () => {
    await configureWorktreeGitIdentity(worktreeA, {
      username: 'alice',
      email: 'alice@example.com',
    });
    await configureWorktreeGitIdentity(worktreeB, {
      username: 'bob',
      github_id: 99,
    });

    const authorA = await commitAsConfigured(worktreeA, 'a.txt');
    const authorB = await commitAsConfigured(worktreeB, 'b.txt');

    expect(authorA).toBe('alice <alice@example.com>');
    expect(authorB).toBe('bob <99+bob@users.noreply.github.com>');
  });
});
