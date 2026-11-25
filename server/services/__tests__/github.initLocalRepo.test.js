import { describe, it, expect, vi, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(execFile);

const { TEST_REPOS_DIR } = vi.hoisted(() => ({
  TEST_REPOS_DIR: `/tmp/baguette-init-local-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, REPOS_DIR: TEST_REPOS_DIR };
});

const { initLocalRepo } = await import('../github.js');

describe('initLocalRepo', () => {
  const strippedName = 'scratch-repo';

  afterAll(async () => {
    await fs.promises.rm(TEST_REPOS_DIR, { recursive: true, force: true });
  });

  it('creates the initial branch as main', async () => {
    const repoPath = await initLocalRepo(strippedName);
    const { stdout } = await execAsync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: repoPath,
      stdio: 'pipe',
    });
    expect(stdout.trim()).toBe('main');
  });
});
