import { z } from 'zod';
import { getOpenPRByNumber } from '../../github.js';
import { ok, fail } from '../lib/result.js';

export function createGetGithubPrTool(ctx) {
  const { getRepo, getToken, requireGitHubRepo } = ctx;
  return {
    name: 'GetGithubPr',
    description:
      'Get full details for a single pull request by number, including head/base branch names, body, labels, draft status, and timestamps.',
    schema: {
      pr_number: z.number().int().describe('Pull request number'),
    },
    handler: async ({ pr_number } = {}) => {
      const localErr = await requireGitHubRepo();
      if (localErr) return localErr;
      const repo = await getRepo();
      if (!repo?.full_name) return fail('No repo linked to this session.');
      try {
        const pr = await getOpenPRByNumber(await getToken(), repo.full_name, pr_number);
        return ok({ pr });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
