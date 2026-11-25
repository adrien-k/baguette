import {
  isAgentFixedPushTarget,
  parseAgentFixedPushBranches,
} from './agent-fixed-push-branches.js';

/**
 * @param {{ branch?: string | null, sessionBranch?: string | null }}
 */
export function resolveGitPushTargetBranch({ branch, sessionBranch }) {
  if (typeof branch === 'string' && branch.trim()) return branch.trim();
  return sessionBranch || null;
}

/**
 * Whether a GitPush MCP call should open the Push approval modal.
 * Mirrors `server/services/mcp/tools/git-push.js` and client git push cards.
 *
 * @param {{
 *   force?: string | null,
 *   branch?: string | null,
 *   source_branch?: string | null,
 *   session?: {
 *     remote_branch?: string | null,
 *     local_branch?: string | null,
 *     auto_push?: boolean | number | null,
 *     agent_fixed_push_branches?: unknown,
 *   } | null,
 *   agentFixedPushBranches?: string[] | null,
 * }} params
 */
export function gitPushRequiresApproval(params) {
  const { force, branch, source_branch: sourceBranch, session, agentFixedPushBranches } = params;
  const isForcePush = force === 'lease' || force === 'force';
  if (isForcePush) return true;

  if (!session) {
    if (typeof branch === 'string' && branch.trim()) return true;
    if (typeof sourceBranch === 'string' && sourceBranch.trim()) return true;
    return false;
  }

  const sessionBranch = session.remote_branch || session.local_branch || null;
  const localBranch = session.local_branch || null;
  const cleanedSourceBranch =
    typeof sourceBranch === 'string' && sourceBranch.trim() ? sourceBranch.trim() : null;
  const hasSourceBranch = !!cleanedSourceBranch;
  const autoPushOff = !session.auto_push;

  const fixedBranches =
    agentFixedPushBranches ?? parseAgentFixedPushBranches(session.agent_fixed_push_branches);

  const targetBranch = resolveGitPushTargetBranch({
    branch: typeof branch === 'string' && branch ? branch : null,
    sessionBranch,
  });

  if (!autoPushOff && isAgentFixedPushTarget(targetBranch, fixedBranches)) {
    return false;
  }

  const isNonSessionBranch = branch && branch !== sessionBranch && branch !== localBranch;
  return !!(isNonSessionBranch || autoPushOff || hasSourceBranch);
}
