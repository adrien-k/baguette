import { z } from 'zod';
import { getPRWorkflows } from '../../github.js';
import { ok } from '../lib/result.js';

const workflowConclusion = z.enum([
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'stale',
  'startup_failure',
]);

const workflowStatus = z.enum([
  'completed',
  'in_progress',
  'queued',
  'waiting',
  'requested',
  'pending',
]);

export function createPrWorkflowsTool(ctx) {
  const { getSession, getToken, requireGitHubRepo } = ctx;
  return {
    name: 'PrWorkflows',
    description:
      'Get CI status for the PR branch: recent Actions workflow runs (with jobs, workflow path, and run metadata) and check-run rollup for the PR head (name, conclusion, required, app), matching the GitHub PR checks list. Resolves the open PR by branch when the session has no pr_number. checks_source reports the rollup source: "graphql" (includes branch-protection required) or "rest" (fallback; required is always false there). Optional filters and wait/poll until runs finish. When waiting ends without confirmed completion, the response carries wait_timed_out (deadline elapsed), wait_fetch_failed (last poll request failed), and/or wait_run_not_found (wait_for_run_id was never observed).',
    schema: {
      conclusion: workflowConclusion
        .optional()
        .describe('If set, return only workflow runs with this conclusion'),
      status: workflowStatus
        .optional()
        .describe(
          'If set, return only workflow runs with this status (e.g. in_progress, completed)'
        ),
      wait_for_completion: z
        .boolean()
        .optional()
        .describe(
          'When true, poll until no recent runs are queued/in_progress (or wait_timeout_seconds elapses)'
        ),
      wait_for_run_id: z
        .string()
        .optional()
        .describe(
          'Poll until this workflow run id (from a prior PrWorkflows call) is no longer in progress. The run is polled by id, so it is found even when newer runs slide it out of the branch page.'
        ),
      wait_timeout_seconds: z
        .number()
        .int()
        .min(5)
        .max(600)
        .optional()
        .describe(
          'Max seconds to poll when wait_for_completion or wait_for_run_id is set (default 120)'
        ),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .describe('Number of recent workflow runs to include (default 10)'),
    },
    handler: async ({
      conclusion,
      status,
      wait_for_completion: waitForCompletion,
      wait_for_run_id: waitForRunId,
      wait_timeout_seconds: waitTimeoutSeconds,
      per_page: perPage,
    } = {}) => {
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
      const payload = await getPRWorkflows(await getToken(), session.repo_full_name, branch, {
        prNumber: session.pr_number ?? undefined,
        conclusion,
        status,
        waitForCompletion: Boolean(waitForCompletion),
        waitForRunId,
        waitTimeoutSeconds,
        perPage,
      });
      return ok(payload);
    },
  };
}
