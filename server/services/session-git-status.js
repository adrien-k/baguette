import { resolveDataDirRelativePath } from '../config.js';
import { gitCommitCountSince, gitCommitCountSinceBase, gitCommitsToPush } from './github.js';
import { isGlobalSession } from '../../shared/session-scope.js';

/**
 * @returns {Promise<{ commitsToPush: number, commitsSinceReview: number }>}
 */
export async function computeSessionGitStatus(session) {
  if (isGlobalSession(session) || !session?.worktree_path) {
    return { commitsToPush: 0, commitsSinceReview: 0 };
  }
  const cwd = resolveDataDirRelativePath(session.worktree_path);
  const remoteBranch = session.remote_branch || session.local_branch;
  const commitsToPush = await gitCommitsToPush(cwd, remoteBranch);
  const sinceReview = session.last_reviewed_commit_sha;
  const commitsSinceReview = sinceReview
    ? await gitCommitCountSince(cwd, sinceReview)
    : await gitCommitCountSinceBase(cwd, session.base_branch);
  return { commitsToPush, commitsSinceReview };
}
