import { z } from 'zod';
import { ok } from '../lib/result.js';

export function createListLoopsTool(ctx) {
  const { app, userId } = ctx;
  const userParams = { provider: 'rest', user: { id: userId } };
  return {
    name: 'ListLoops',
    description: 'List your scheduled session loops, newest first.',
    schema: {
      repo_full_name: z.string().optional().describe('Filter by repository full name'),
      is_global: z.boolean().optional().describe('Filter to global loops'),
    },
    handler: async ({ repo_full_name, is_global } = {}) => {
      const query = {};
      if (repo_full_name) query.repo_full_name = repo_full_name;
      if (is_global) query.is_global = true;
      const result = await app.service('loops').find({ ...userParams, query });
      const loops = Array.isArray(result) ? result : (result?.data ?? []);
      return ok({ loops });
    },
  };
}
