import { parseAgentFixedPushBranches } from '../../../../shared/agent-fixed-push-branches.js';
import { gitPushRequiresApproval } from '../../../../shared/git-push-approval.js';

/**
 * Mirrors approval vs direct-push branching in `server/services/mcp/tools/git-push.js`.
 * @param {string[] | null | undefined} agentFixedPushBranches from the linked repo (Settings)
 */
export function gitPushNeedsApproval(args, session, agentFixedPushBranches = null) {
  const fixed =
    agentFixedPushBranches ??
    (session ? parseAgentFixedPushBranches(session.agent_fixed_push_branches) : []);
  return gitPushRequiresApproval({
    force: args?.force,
    branch: args?.branch,
    source_branch: args?.source_branch,
    session: session ?? null,
    agentFixedPushBranches: fixed,
  });
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
    const autoPushDetail =
      triggers.length > 0
        ? 'Auto-push is disabled, so this push needs approval.'
        : 'Session-branch pushes need your approval while auto-push is disabled.';
    triggers.push({
      key: 'auto_push_off',
      title: 'Auto-push is off',
      detail: autoPushDetail,
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
  const sourceFromResult =
    typeof mcpResult?.source_branch === 'string' && mcpResult.source_branch.trim()
      ? mcpResult.source_branch.trim()
      : null;
  const sourceFromArgs =
    typeof args?.source_branch === 'string' && args.source_branch.trim()
      ? args.source_branch.trim()
      : null;
  const sourceBranch = sourceFromResult ?? sourceFromArgs ?? null;
  const localBranchFromResult =
    typeof mcpResult?.local_branch === 'string' && mcpResult.local_branch
      ? mcpResult.local_branch
      : null;
  const localBranch = sourceBranch ?? localBranchFromResult ?? null;

  return { targetBranch, localBranch };
}
