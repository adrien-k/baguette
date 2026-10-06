import { z } from 'zod';
import { ok, fail } from '../lib/result.js';

export function createListBranchesTool(ctx) {
  const { app, userId, userParams, requireRepoAccess } = ctx;
  return {
    name: 'ListBranches',
    description:
      'List git branches for a repository (for choosing base_branch when creating a session). Pass repo_id from ListRepos.',
    schema: {
      repo_id: z.number().int().describe('Repository id from ListRepos'),
    },
    handler: async ({ repo_id }) => {
      const repo = await requireRepoAccess(repo_id);
      if (!repo) return fail(`Repository ${repo_id} not found or not linked to your account.`);
      try {
        const fullUser = await app.service('users').get(userId, {});
        const result = await app.service('repos').branches(repo.full_name, {
          ...userParams,
          user: fullUser,
        });
        return ok({ repo_id, full_name: repo.full_name, branches: result.branches ?? [] });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
