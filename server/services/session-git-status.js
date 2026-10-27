import { resolveDataDirRelativePath } from '../config.js';
import { gitCommitCountSinceBase, gitCommitsToPush } from './github.js';
import { isGlobalSession } from '../../shared/session-scope.js';

const PR_METADATA_FIELDS = ['label', 'pr_description', 'base_branch'];

/** True when PR title/body/base changed locally since the last successful push. */
export function sessionNeedsPrMetadataSync(session) {
  if (!session?.pr_number) return false;
  const metaAt = session.pr_metadata_updated_at;
  if (!metaAt) return false;
  const pushedAt = session.last_pushed_at;
  if (!pushedAt) return true;
  return new Date(metaAt).getTime() > new Date(pushedAt).getTime();
}

export function touchPrMetadataUpdatedAtOnPatch(context) {
  const data = context.data;
  if (!data) return context;
  const session = context.params.ownSession;
  if (!session) return context;
  for (const field of PR_METADATA_FIELDS) {
    if (!(field in data)) continue;
    if (data[field] !== session[field]) {
      data.pr_metadata_updated_at = new Date().toISOString();
      break;
    }
  }
  return context;
}

/**
 * @returns {Promise<{ commitsToPush: number, commitsSinceReview: number }>}
 */
export async function computeSessionGitStatus(session) {
  if (isGlobalSession(session) || !session?.session_path) {
    return { commitsToPush: 0, commitsSinceReview: 0 };
  }
  const cwd = resolveDataDirRelativePath(session.session_path);
  const remoteBranch = session.remote_branch || session.local_branch;
  const commitsToPush = await gitCommitsToPush(cwd, remoteBranch);
  const commitsSinceReview = await gitCommitCountSinceBase(cwd, session.base_branch);
  return { commitsToPush, commitsSinceReview };
}
