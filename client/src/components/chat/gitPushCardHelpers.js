/**
 * Mirrors approval vs direct-push branching in `server/services/mcp/tools/git-push.js`.
 */
export function gitPushNeedsApproval(args, session) {
  const force = args?.force;
  const isForcePush = force === 'lease' || force === 'force';
  const branch = typeof args?.branch === 'string' && args.branch ? args.branch : null;

  if (!session) {
    if (isForcePush) return true;
    if (branch) return true;
    return false;
  }

  const sessionBranch = session.remote_branch || session.local_branch || null;
  const localBranch = session.local_branch || null;
  const isNonSessionBranch = branch && branch !== sessionBranch && branch !== localBranch;
  const autoPushOff = !session.auto_push;

  return isForcePush || isNonSessionBranch || autoPushOff;
}

export function resolveGitPushBranches(args, mcpResult, session) {
  const argsBranch = typeof args?.branch === 'string' && args.branch ? args.branch : null;
  const resultBranch =
    typeof mcpResult?.branch === 'string' && mcpResult.branch ? mcpResult.branch : null;
  const targetBranch =
    (typeof mcpResult?.target_branch === 'string' && mcpResult.target_branch) ||
    resultBranch ||
    argsBranch ||
    (typeof session?.remote_branch === 'string' && session.remote_branch) ||
    'session branch';
  const localBranch =
    (typeof mcpResult?.local_branch === 'string' &&
      mcpResult.local_branch &&
      mcpResult.local_branch) ||
    null;

  return { targetBranch, localBranch };
}
