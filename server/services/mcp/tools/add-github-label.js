import { z } from 'zod';
import { addLabelsToPR } from '../../github.js';
import { ok, fail } from '../lib/result.js';

export function createAddGithubLabelTool(ctx) {
  const { getRepo, getToken, requireGitHubRepo } = ctx;
  return {
    name: 'AddGithubLabel',
    description: 'Add one or more labels to a pull request. Labels must already exist on the repo.',
    schema: {
      pr_number: z.number().int().describe('Pull request number'),
      labels: z.array(z.string()).min(1).describe('Label names to add'),
    },
    handler: async ({ pr_number, labels } = {}) => {
      const localErr = await requireGitHubRepo();
      if (localErr) return localErr;
      const repo = await getRepo();
      if (!repo?.full_name) return fail('No repo linked to this session.');
      try {
        const all_labels = await addLabelsToPR(await getToken(), repo.full_name, pr_number, labels);
        return ok({ labels: all_labels });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
