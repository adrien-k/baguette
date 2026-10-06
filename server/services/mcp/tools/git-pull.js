import { gitPull } from '../../github.js';
import { ok } from '../lib/result.js';

export function createGitPullTool(ctx) {
  const { getToken, absoluteWorktreePath, session } = ctx;
  return {
    name: 'GitPull',
    description: 'Pull latest changes from the remote branch into the current worktree.',
    schema: {},
    handler: async () => {
      if (!session?.remote_branch) return ok({ message: 'No remote branch to pull.' });
      const result = await gitPull(absoluteWorktreePath, session.remote_branch, await getToken());
      return ok(result);
    },
  };
}
