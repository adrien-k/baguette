import { getPRWorkflows } from '../../github.js';
import { ok } from '../lib/result.js';

export function createPrWorkflowsTool(ctx) {
  const { getSession, getToken, requireGitHubRepo } = ctx;
  return {
    name: 'PrWorkflows',
    description:
      'Get CI status for the PR branch: recent Actions workflow runs (with jobs, workflow path, and run metadata) and check-run rollup for the PR head (name, conclusion, required, app), matching the GitHub PR checks list.',
    schema: {},
    handler: async () => {
      const localErr = await requireGitHubRepo();
      if (localErr) return localErr;
      const session = await getSession();
      const branch = session?.remote_branch || session?.local_branch;
      if (!branch) {
        return ok({
          runs: [],
          checks: [],
          head_sha: null,
          message: 'No branch available for this session.',
        });
      }
      const { runs, checks, head_sha } = await getPRWorkflows(
        await getToken(),
        session.repo_full_name,
        branch,
        { prNumber: session.pr_number ?? undefined }
      );
      return ok({ runs, checks, head_sha });
    },
  };
}
