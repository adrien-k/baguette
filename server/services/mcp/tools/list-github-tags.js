import { listRepoTags } from '../../github.js';
import { ok, fail } from '../lib/result.js';

export function createListGithubTagsTool(ctx) {
  const { getRepo, getToken, requireGitHubRepo } = ctx;
  return {
    name: 'ListGithubTags',
    description: 'List git tags for the current repo (most recent 50).',
    schema: {},
    handler: async () => {
      const localErr = await requireGitHubRepo();
      if (localErr) return localErr;
      const repo = await getRepo();
      if (!repo?.full_name) return fail('No repo linked to this session.');
      try {
        const tags = await listRepoTags(await getToken(), repo.full_name);
        return ok({ tags });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
