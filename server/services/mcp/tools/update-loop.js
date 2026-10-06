import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { loopPatchSchema } from '../lib/loop-schemas.js';

export function createUpdateLoopTool(ctx) {
  const { app, userId } = ctx;
  const userParams = { provider: 'rest', user: { id: userId } };
  return {
    name: 'UpdateLoop',
    description: 'Patch an existing loop. Only include fields to change.',
    schema: {
      loop_id: z.number().int(),
      repo_full_name: z.string().optional(),
      ...loopPatchSchema,
    },
    handler: async ({ loop_id, ...patch }) => {
      try {
        const loop = await app.service('loops').patch(loop_id, patch, userParams);
        return ok({ loop });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
