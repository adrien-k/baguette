import { z } from 'zod';
import { gitPush } from '../../github.js';
import { ok, fail } from '../lib/result.js';

export function createGitPushTool(ctx) {
  const {
    app,
    session,
    getSession,
    getToken,
    requireGitHubRepo,
    patchSession,
    absoluteWorktreePath,
  } = ctx;
  return {
    name: 'GitPush',
    description:
      'Push a branch to origin and set upstream. Call only after any `git commit` in this turn has finished (do not invoke in parallel with commit). For normal pushes, omit all parameters. Use force: "lease" after a rebase (--force-with-lease). Use force: "force" or a non-session branch to open the Push modal for user confirmation before pushing.',
    schema: {
      branch: z
        .string()
        .optional()
        .describe(
          'Branch to push (defaults to current session branch). Specifying a different branch opens the Push modal for user confirmation.'
        ),
      force: z
        .enum(['lease', 'force'])
        .optional()
        .describe(
          '"lease" = --force-with-lease (safe, use after rebase); "force" = --force (destructive, opens the Push modal for user confirmation)'
        ),
    },
    handler: async ({ branch, force } = {}) => {
      const localErr = await requireGitHubRepo();
      if (localErr) return localErr;
      if (!session.auto_push) {
        return ok({
          message:
            'Auto-push is disabled. Changes have been committed locally. The user can push manually or enable auto-push using the controls at the bottom of the chat. Call PrUpsert with an appropriate title and description — it saves them to the session even when auto-push is off.',
        });
      }

      const freshSession = await getSession();
      const sessionBranch = freshSession.remote_branch || freshSession.local_branch;
      const isPureForce = force === 'force';
      const isNonSessionBranch =
        branch && branch !== sessionBranch && branch !== freshSession.local_branch;

      if (isPureForce || isNonSessionBranch) {
        app.service('sessions').emit('push:request', {
          sessionId: session.id,
          branch: branch || sessionBranch,
          forceMode: force || null,
        });
        return ok({
          message:
            'The Push modal has been opened with your settings. Please review and confirm the push in the UI.',
        });
      }

      let result;
      try {
        result = await gitPush(absoluteWorktreePath, await getToken(), {
          force: force === 'lease',
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
          hint: 'The previous PR for this session has been merged. You should: 1) call GitPull to sync with the latest changes from the remote branch and merge the base branch — resolve any conflicts, commit, and push again if needed, then 2) call PrUpsert to open a new pull request for the current changes.',
        });
      }
      return ok(result);
    },
  };
}
