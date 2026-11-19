import { execFile } from 'node:child_process';
import { promisify } from 'util';
import { BadRequest } from 'feathers/errors';

const execFileAsync = promisify(execFile);

async function gitInWorktree(worktreePath, args) {
  return execFileAsync('git', ['-C', worktreePath, ...args], { stdio: 'pipe' });
}

/**
 * When pushing source_branch onto the session branch, move the session checkout forward
 * so the next commit on HEAD remains a fast-forward of origin.
 */
export async function fastForwardWorktreeToSourceBranch(worktreePath, sourceBranch) {
  const { stdout: statusOut } = await gitInWorktree(worktreePath, ['status', '--porcelain']);
  if (statusOut.trim()) {
    throw new BadRequest(
      'Cannot push a source branch onto the session branch while the worktree has uncommitted changes'
    );
  }

  let sourceSha;
  try {
    const { stdout } = await gitInWorktree(worktreePath, ['rev-parse', '--verify', sourceBranch]);
    sourceSha = stdout.trim();
  } catch {
    throw new BadRequest(`Source branch not found: ${sourceBranch}`);
  }

  try {
    await gitInWorktree(worktreePath, ['merge-base', '--is-ancestor', 'HEAD', sourceSha]);
  } catch {
    throw new BadRequest(
      'Cannot fast-forward the session worktree to the source branch: the source ref is not ahead of the current checkout'
    );
  }

  await gitInWorktree(worktreePath, ['merge', '--ff-only', sourceBranch]);
}
