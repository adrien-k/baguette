import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { gitPush } from '../../github.js';
import { ok, fail } from '../lib/result.js';

export function createGitPushTool(ctx) {
  const {
    app,
    session,
    getSession,
    getGitAuth,
    requireRemoteRepo,
    patchSession,
    absoluteSessionPath,
  } = ctx;
  return {
    name: 'GitPush',
    description:
      'Push the session work to origin. NOT for regular turn work: Baguette pushes and syncs the PR automatically after each turn — calling this for a routine push of the session branch only duplicates that. Anything beyond a plain session-branch push with auto-push on opens the Push approval modal for the user to confirm: a different target branch (e.g. branch: "development" to fast-forward a shared branch), a force option ("lease" = --force-with-lease, "force" = --force overwrites remote history — only when the user explicitly asks to force), or auto-push being disabled (the user is asked whether to push once anyway). Always pass reason with a short explanation of why the push is needed; it is shown to the user in the approval. While the approval is open, do not retry and do not push via shell git — the push runs once the user confirms.',
    schema: {
      branch: z
        .string()
        .optional()
        .describe(
          'Target branch on origin (defaults to the current session branch). A different branch requires user approval via the Push modal.'
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
    handler: async ({ branch, force, reason } = {}) => {
      const localErr = await requireRemoteRepo();
      if (localErr) return localErr;

      const freshSession = await getSession();
      const sessionBranch = freshSession.remote_branch || freshSession.local_branch;
      const isForcePush = force === 'lease' || force === 'force';
      const isNonSessionBranch =
        branch && branch !== sessionBranch && branch !== freshSession.local_branch;
      const autoPushOff = !freshSession.auto_push;
      const cleanedReason = typeof reason === 'string' && reason.trim() ? reason.trim() : null;

      if (!isForcePush && !isNonSessionBranch && !autoPushOff) {
        // Plain session-branch push with auto-push on — identical to what
        // Baguette does automatically after the turn, so no approval is needed.
        let result;
        try {
          result = await gitPush(absoluteSessionPath, await getGitAuth(), {
            ...(sessionBranch ? { branch: sessionBranch } : {}),
          });
        } catch (err) {
          if (err.rejected) return fail(err.message);
          throw err;
        }
        await patchSession({ remote_branch: result.branch });
        if (freshSession?.pr_status === 'merged') {
          return ok({
            ...result,
            hint: 'The previous PR for this session has been merged. You should: 1) call GitPull to sync with the latest changes from the remote branch and merge the base branch — resolve any conflicts, commit, and push again if needed, then 2) call UpdateSession with a title and description; Baguette will open a new pull request after the turn.',
          });
        }
        return ok(result);
      }

      // Agent-initiated approval: never touches PRs (no create, no sync) —
      // PR handling is Baguette's automatic post-turn behavior.
      const requestId = randomUUID();
      app.service('sessions').emit('push:request', {
        sessionId: session.id,
        request_id: requestId,
        branch: branch || sessionBranch,
        forceMode: force || null,
        reason: cleanedReason,
        autoPushOff,
        agentRequest: true,
      });
      return ok({
        message:
          'The Push approval has been opened in the UI. Do not retry and do not push with shell git — the push runs once the user confirms it.',
        approval_requested: true,
        request_id: requestId,
        local_branch: sessionBranch || null,
        target_branch: branch || sessionBranch || null,
        force: force || null,
        reason: cleanedReason,
        auto_push_off: autoPushOff,
      });
    },
  };
}
