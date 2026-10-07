import { z } from 'zod';
import { listModelsForUser } from '../../baguette-models-for-user.js';
import { ok, fail } from '../lib/result.js';

export function createListModelsTool(ctx) {
  const { app, userId, requireRepoAccess, loadRepoWithKeys } = ctx;
  return {
    name: 'ListModels',
    description:
      'List agent models grouped by SDK, including session usage counts. Requires repo_id — credentials use repository keys with account fallback. Prefer models with higher session_count.',
    schema: {
      repo_id: z
        .number()
        .int()
        .describe('Repository id — models and credentials are resolved per repository'),
    },
    handler: async ({ repo_id }) => {
      try {
        if (repo_id == null) {
          return fail('repo_id is required');
        }
        const fullUser = await app.service('users').get(userId, {});
        const access = await requireRepoAccess(repo_id);
        if (!access) {
          return fail(`Repository ${repo_id} not found or not linked to your account.`);
        }
        const repo = (await loadRepoWithKeys(repo_id)) ?? {
          id: access.id,
          full_name: access.full_name,
        };
        const result = await listModelsForUser(fullUser, repo, app);
        return ok(result);
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
