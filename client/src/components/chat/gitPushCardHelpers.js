/**
 * Mirrors approval vs direct-push branching in `server/services/mcp/tools/git-push.js`.
 */
export function gitPushNeedsApproval(args, session) {
  const force = args?.force;
  const isForcePush = force === 'lease' || force === 'force';
  const branch = typeof args?.branch === 'string' && args.branch ? args.branch : null;
  const sourceBranch =
    typeof args?.source_branch === 'string' && args.source_branch.trim()
      ? args.source_branch.trim()
      : null;

  if (!session) {
    if (isForcePush) return true;
    if (branch) return true;
    if (sourceBranch) return true;
    return false;
  }

  const sessionBranch = session.remote_branch || session.local_branch || null;
  const localBranch = session.local_branch || null;
  const isNonSessionBranch = branch && branch !== sessionBranch && branch !== localBranch;
  const autoPushOff = !session.auto_push;

  return isForcePush || isNonSessionBranch || autoPushOff || !!sourceBranch;
}

/** Human-readable triggers that require GitPush user approval (matches git-push MCP handler). */
export function gitPushApprovalTriggers({
  forceMode = null,
  targetBranch = null,
  sourceBranch = null,
  sessionRemoteBranch = null,
  sessionLocalBranch = null,
  autoPushOff = false,
}) {
  const triggers = [];
  const sessionBranch = sessionRemoteBranch || sessionLocalBranch || null;
  const trimmedSource =
    typeof sourceBranch === 'string' && sourceBranch.trim() ? sourceBranch.trim() : null;
  const explicitTarget =
    typeof targetBranch === 'string' && targetBranch.trim() ? targetBranch.trim() : null;

  if (forceMode === 'force') {
    triggers.push({
      key: 'force',
      title: 'Force push',
      detail: 'Uses --force and can overwrite remote history.',
    });
  } else if (forceMode === 'lease') {
    triggers.push({
      key: 'force_lease',
      title: 'Force with lease',
      detail: 'Uses --force-with-lease.',
    });
  }

  if (trimmedSource) {
    triggers.push({
      key: 'source',
      title: 'Different source ref',
      detail: `Pushes from ${trimmedSource} instead of the usual session HEAD.`,
    });
  }

  const isNonSessionBranch =
    explicitTarget &&
    sessionBranch &&
    explicitTarget !== sessionBranch &&
    explicitTarget !== sessionLocalBranch;
  if (isNonSessionBranch) {
    triggers.push({
      key: 'target',
      title: 'Different target branch',
      detail: `Destination is origin/${explicitTarget}, not the session branch (${sessionBranch}).`,
    });
  }

  if (autoPushOff) {
    triggers.push({
      key: 'auto_push_off',
      title: 'Auto-push is off',
      detail: 'Session-branch pushes need your approval while auto-push is disabled.',
    });
  }

  return triggers;
}

/** Reconstruct `push:request` payload from a stored GitPush tool result (re-open modal). */
export function buildGitPushApprovalRequestEvent(sessionId, args, mcpResult, session) {
  const { targetBranch } = resolveGitPushBranches(args, mcpResult, session);
  const forceFromResult = mcpResult?.force;
  const forceFromArgs = args?.force;
  const forceRaw = forceFromResult != null ? forceFromResult : forceFromArgs;
  let forceMode = null;
  if (forceRaw === 'lease' || forceRaw === 'force') forceMode = forceRaw;

  const sourceFromResult =
    typeof mcpResult?.source_branch === 'string' && mcpResult.source_branch.trim()
      ? mcpResult.source_branch.trim()
      : null;
  const sourceFromArgs =
    typeof args?.source_branch === 'string' && args.source_branch.trim()
      ? args.source_branch.trim()
      : null;

  const argsReason =
    typeof args?.reason === 'string' && args.reason.trim() ? args.reason.trim() : null;
  const reason =
    typeof mcpResult?.reason === 'string' && mcpResult.reason.trim()
      ? mcpResult.reason.trim()
      : argsReason;

  return {
    sessionId,
    branch: targetBranch,
    source_branch: sourceFromResult ?? sourceFromArgs,
    forceMode,
    reason,
    autoPushOff: mcpResult?.auto_push_off === true,
    agentRequest: true,
    request_id:
      typeof mcpResult?.request_id === 'string' && mcpResult.request_id
        ? mcpResult.request_id
        : null,
  };
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
