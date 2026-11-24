import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { gitPush } from '../../github.js';
import { ok, fail } from '../lib/result.js';
import { parseAgentFixedPushBranches } from '../../../../shared/agent-fixed-push-branches.js';
import {
  gitPushRequiresApproval,
  resolveGitPushTargetBranch,
} from '../../../../shared/git-push-approval.js';

const GIT_PUSH_AWAITING_APPROVAL_INSTRUCTION =
  'The Push approval modal is open in the UI. This result does NOT mean the push succeeded — the user has not confirmed yet. ' +
  'Do not retry GitPush and do not push with shell git while approval is pending. ' +
  'End your turn immediately after this tool returns with no follow-up message (if required, say only that push approval was requested). ' +
  'Baguette will post the push outcome (success, rejection, or detailed error) as a new user message that starts your next turn when the user acts.';

export function createGitPushTool(ctx) {
  const {
    app,
    session,
    getSession,
    getRepo,
    getGitAuth,
    requireRemoteRepo,
    patchSession,
    absoluteSessionPath,
  } = ctx;
  return {
    name: 'GitPush',
    description:
      'Push the session work to origin. NOT for regular turn work: Baguette pushes and syncs the PR automatically after each turn — calling this for a plain session-branch push with auto-push on only duplicates that. A plain session-branch push with auto-push on goes through immediately (no Push modal). Auto-push off, a different target branch, source_branch, or force opens the Push approval modal for the user to confirm — except when auto-push is on and the target is a repository-configured **agent fixed push branch** (see CurrentSessionInfo `agent_fixed_push_branches`): a non-force push to that branch goes through without approval even with source_branch or a non-session target. Auto-push off still opens the Push modal for every GitPush, including fixed targets. When the Push approval modal opens, end your turn immediately after that tool result (like AskUserQuestions / interactive CreatePlan); Baguette posts the outcome back in chat when the user acts. Valid pattern: after an isolated subagent finishes on its own branch, call GitPush with source_branch set to that branch (no need to merge into the session worktree first); use branch to publish onto a shared integration branch listed in `agent_fixed_push_branches` (e.g. development) or the session remote. Always pass reason with a short explanation of why the push is needed; it is shown to the user in the approval when one is required. While the approval is open, do not retry and do not push via shell git — the push runs once the user confirms.',
    schema: {
      branch: z
        .string()
        .optional()
        .describe(
          'Target branch on origin (defaults to the session remote branch). A different branch requires user approval unless it is listed in the repo agent fixed push branches (CurrentSessionInfo `agent_fixed_push_branches`).'
        ),
      source_branch: z
        .string()
        .optional()
        .describe(
          'Local git ref to push from instead of the session worktree HEAD (branch name, tag, or commit). You do not need to merge that ref into the session branch first — typical use: publish an isolated subagent branch (set to subagent_local_branch); refspec is source_branch:target. User approval is required unless the target branch is an agent fixed push branch for this repository.'
        ),
      force: z
        .enum(['lease', 'force'])
        .optional()
        .describe(
          '"lease" = --force-with-lease (safe after a rebase); "force" = --force (overwrites remote history). Both require user approval via the Push modal.'
        ),
      reason: z
        .string()
        .optional()
        .describe(
          'Short explanation of why this push is needed, shown to the user in the approval (e.g. "fast-forward development with the finished feature work").'
        ),
    },
    handler: async ({ branch, source_branch: sourceBranch, force, reason } = {}) => {
      const localErr = await requireRemoteRepo();
      if (localErr) return localErr;

      const freshSession = await getSession();
      const repo = await getRepo();
      const agentFixedPushBranches = parseAgentFixedPushBranches(repo);
      const sessionBranch = freshSession.remote_branch || freshSession.local_branch;
      const cleanedSourceBranch =
        typeof sourceBranch === 'string' && sourceBranch.trim() ? sourceBranch.trim() : null;
      const autoPushOff = !freshSession.auto_push;
      const cleanedReason = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
      const targetBranch = resolveGitPushTargetBranch({ branch, sessionBranch });

      const needsApproval = gitPushRequiresApproval({
        force,
        branch,
        source_branch: sourceBranch,
        session: freshSession,
        agentFixedPushBranches,
      });

      if (!needsApproval) {
        const pushOpts = {};
        if (targetBranch) pushOpts.branch = targetBranch;
        if (cleanedSourceBranch) pushOpts.sourceBranch = cleanedSourceBranch;

        let result;
        try {
          result = await gitPush(absoluteSessionPath, await getGitAuth(), pushOpts);
        } catch (err) {
          if (err.rejected) return fail(err.message);
          throw err;
        }
        const pushedToSessionBranch =
          targetBranch === sessionBranch ||
          targetBranch === freshSession.local_branch ||
          (!branch && !cleanedSourceBranch);
        if (pushedToSessionBranch) {
          await patchSession({ remote_branch: result.branch });
        }
        if (freshSession?.pr_status === 'merged') {
          return ok({
            ...result,
            hint: 'The previous PR for this session has been merged. You should: 1) call GitPull to sync with the latest changes from the remote branch and merge the base branch — resolve any conflicts, commit, and push again if needed, then 2) call UpdateSession with a title and description; Baguette will open a new pull request after the turn.',
          });
        }
        return ok(result);
      }

      const requestId = randomUUID();
      app.service('sessions').emit('push:request', {
        sessionId: session.id,
        request_id: requestId,
        branch: targetBranch,
        source_branch: cleanedSourceBranch,
        forceMode: force || null,
        reason: cleanedReason,
        autoPushOff,
        agentRequest: true,
      });
      return ok({
        message:
          'The Push approval has been opened in the UI. Do not retry and do not push with shell git — the push runs once the user confirms it.',
        approval_requested: true,
        status: 'awaiting_push_approval',
        instruction: GIT_PUSH_AWAITING_APPROVAL_INSTRUCTION,
        request_id: requestId,
        local_branch: sessionBranch || null,
        source_branch: cleanedSourceBranch,
        target_branch: targetBranch || null,
        force: force || null,
        reason: cleanedReason,
        auto_push_off: autoPushOff,
      });
    },
  };
}
