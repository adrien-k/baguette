import { resolveDataDirRelativePath } from '../config.js';
import { gitCommitCountSinceBase, gitCommitsNotOnAnyRemote, gitCommitsToPush } from './github.js';
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

/**
 * Mark PR metadata as locally updated when a patch changes title/body/base.
 * Patches that load these fields from GitHub (e.g. continuing an existing branch
 * provisions the session from the open PR) pass `params._skipPrMetadataTouch`:
 * loading is not a local update and must not trigger a metadata-only push.
 */
export function touchPrMetadataUpdatedAtOnPatch(context) {
  const data = context.data;
  if (!data) return context;
  if (context.params?._skipPrMetadataTouch) return context;
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
 * @returns {Promise<{
 *   commitsToPush: number,
 *   commitsNotOnAnyRemote: number,
 *   commitsSinceReview: number,
 * }>}
 */
export async function computeSessionGitStatus(session) {
  if (isGlobalSession(session) || !session?.session_path) {
    return { commitsToPush: 0, commitsNotOnAnyRemote: 0, commitsSinceReview: 0 };
  }
  const cwd = resolveDataDirRelativePath(session.session_path);
  const remoteBranch = session.remote_branch || session.local_branch;
  const [commitsToPush, commitsNotOnAnyRemote, commitsSinceReview] = await Promise.all([
    gitCommitsToPush(cwd, remoteBranch),
    gitCommitsNotOnAnyRemote(cwd),
    gitCommitCountSinceBase(cwd, session.base_branch),
  ]);
  return { commitsToPush, commitsNotOnAnyRemote, commitsSinceReview };
}
