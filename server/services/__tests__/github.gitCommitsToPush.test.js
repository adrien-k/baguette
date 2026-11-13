import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { gitCommitsNotOnAnyRemote, gitCommitsToPush } from '../github.js';

const execAsync = promisify(execFile);
const git = (cwd, ...args) => execAsync('git', args, { cwd, stdio: 'pipe' });

describe('gitCommitsToPush / gitCommitsNotOnAnyRemote', () => {
  const TEST_DIR = `/tmp/baguette-commits-to-push-${Math.random().toString(36).slice(2)}`;
  const SESSION_BRANCH = 'session-branch';
  let workPath;

  beforeAll(async () => {
    await fs.promises.mkdir(TEST_DIR, { recursive: true });
    const remotePath = path.join(TEST_DIR, 'remote.git');
    workPath = path.join(TEST_DIR, 'work');

    await execAsync('git', ['init', '--bare', remotePath], { stdio: 'pipe' });
    await execAsync('git', ['clone', remotePath, workPath], { stdio: 'pipe' });
    await git(workPath, 'config', 'user.email', 'test@test.com');
    await git(workPath, 'config', 'user.name', 'Test');
    await git(workPath, 'checkout', '-b', 'main');

    await fs.promises.writeFile(path.join(workPath, 'README.md'), '# Test\n');
    await git(workPath, 'add', '.');
    await git(workPath, 'commit', '-m', 'init');
    await git(workPath, 'push', '-u', 'origin', 'main');

    await git(workPath, 'checkout', '-b', SESSION_BRANCH);
    await fs.promises.writeFile(path.join(workPath, 'local.txt'), 'local\n');
    await git(workPath, 'add', '.');
    await git(workPath, 'commit', '-m', 'session-only commit');
  });

  afterAll(async () => {
    await fs.promises.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('counts a never-pushed session commit as both ahead of the named branch and not on any remote', async () => {
    expect(await gitCommitsNotOnAnyRemote(workPath)).toBe(1);
    expect(await gitCommitsToPush(workPath, SESSION_BRANCH)).toBe(1);
  });

  it('does not treat commits already on another remote as missing from every remote', async () => {
    await git(workPath, 'push', 'origin', 'HEAD:parent-branch');
    await git(workPath, 'fetch', 'origin');

    expect(await gitCommitsNotOnAnyRemote(workPath)).toBe(0);
    expect(await gitCommitsToPush(workPath, SESSION_BRANCH)).toBe(0);
  });

  it('still counts commits ahead of the named remote after they exist on another remote', async () => {
    await git(workPath, 'push', '-u', 'origin', SESSION_BRANCH);
    await fs.promises.writeFile(path.join(workPath, 'again.txt'), 'again\n');
    await git(workPath, 'add', '.');
    await git(workPath, 'commit', '-m', 'ahead of session remote');
    await git(workPath, 'push', 'origin', 'HEAD:parent-branch');
    await git(workPath, 'fetch', 'origin');

    expect(await gitCommitsNotOnAnyRemote(workPath)).toBe(0);
    expect(await gitCommitsToPush(workPath, SESSION_BRANCH)).toBe(1);
  });
});
