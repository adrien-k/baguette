import { z } from 'zod';
import { ok, fail } from '../lib/result.js';

export function createDeleteLoopTool(ctx) {
  const { app, userId } = ctx;
  const userParams = { provider: 'rest', user: { id: userId } };
  return {
    name: 'DeleteLoop',
    description: 'Delete a loop permanently.',
    schema: { loop_id: z.number().int() },
    handler: async ({ loop_id }) => {
      try {
        await app.service('loops').remove(loop_id, userParams);
        return ok({ deleted: true, loop_id });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
