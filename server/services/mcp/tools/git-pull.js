import { gitPull } from '../../github.js';
import { ok } from '../lib/result.js';

export function createGitPullTool(ctx) {
  const { getGitAuth, requireRemoteRepo, absoluteSessionPath, session } = ctx;
  return {
    name: 'GitPull',
    description: 'Pull latest changes from the remote branch into the current worktree.',
    schema: {},
    handler: async () => {
      const localErr = await requireRemoteRepo();
      if (localErr) return localErr;
      if (!session?.remote_branch) return ok({ message: 'No remote branch to pull.' });
      const result = await gitPull(absoluteSessionPath, session.remote_branch, await getGitAuth());
      return ok(result);
    },
  };
}
