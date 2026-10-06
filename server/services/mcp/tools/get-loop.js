import { z } from 'zod';
import { ok, fail } from '../lib/result.js';

export function createGetLoopTool(ctx) {
  const { app, userId } = ctx;
  const userParams = { provider: 'rest', user: { id: userId } };
  return {
    name: 'GetLoop',
    description: 'Get a single loop by id.',
    schema: { loop_id: z.number().int() },
    handler: async ({ loop_id }) => {
      try {
        const loop = await app.service('loops').get(loop_id, userParams);
        return ok({ loop });
      } catch (err) {
        return fail(err.message ?? 'Loop not found');
      }
    },
  };
}
