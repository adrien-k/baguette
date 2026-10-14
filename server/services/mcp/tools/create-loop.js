import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { loopPatchSchema } from '../lib/loop-schemas.js';
import { applyLoopPresetModel } from '../lib/apply-loop-preset-model.js';

export function createCreateLoopTool(ctx) {
  const { app, userId } = ctx;
  const userParams = { provider: 'rest', user: { id: userId } };
  return {
    name: 'CreateLoop',
    description:
      'Create a recurring session loop (same fields as the dashboard loop form). Requires prompt and schedule fields. Pass is_global for a global loop, or repo_full_name and base_branch for a repo loop.',
    schema: {
      repo_full_name: z.string().optional(),
      is_global: z.boolean().optional(),
      base_branch: z.string().optional(),
      prompt: z.string(),
      ...loopPatchSchema,
    },
    handler: async (data) => {
      try {
        await applyLoopPresetModel(app, userId, data);
        const loop = await app.service('loops').create(data, userParams);
        return ok({ loop });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
