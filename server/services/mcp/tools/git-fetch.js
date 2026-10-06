import { z } from 'zod';
import { gitFetch } from '../../github.js';
import { ok } from '../lib/result.js';

export function createGitFetchTool(ctx) {
  const { getToken, absoluteWorktreePath } = ctx;
  return {
    name: 'GitFetch',
    description: 'Fetch a branch from origin without modifying the working tree.',
    schema: { branch: z.string().describe('Branch name to fetch') },
    handler: async ({ branch }) => {
      const result = await gitFetch(absoluteWorktreePath, await getToken(), branch);
      return ok(result);
    },
  };
}
