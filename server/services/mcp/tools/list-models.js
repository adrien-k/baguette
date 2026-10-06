import { z } from 'zod';
import { listModelsForUser } from '../../baguette-models-for-user.js';
import { ok, fail } from '../lib/result.js';

export function createListModelsTool(ctx) {
  const { app, userId, requireRepoAccess, loadRepoWithKeys } = ctx;
  return {
    name: 'ListModels',
    description:
      'List agent models grouped by SDK (claude, cursor), including session usage counts. Only SDKs with a configured API key (account or, when repo_id is set, repository) are included. Prefer models with higher session_count.',
    schema: {
      repo_id: z
        .number()
        .int()
        .optional()
        .describe(
          'Optional repository id — include repo-level API keys when listing models for CreateSession'
        ),
    },
    handler: async ({ repo_id }) => {
      try {
        const fullUser = await app.service('users').get(userId, {});
        let repo = null;
        if (repo_id != null) {
          const access = await requireRepoAccess(repo_id);
          if (!access) {
            return fail(`Repository ${repo_id} not found or not linked to your account.`);
          }
          repo = await loadRepoWithKeys(repo_id);
        }
        const result = await listModelsForUser(fullUser, repo);
        return ok(result);
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
