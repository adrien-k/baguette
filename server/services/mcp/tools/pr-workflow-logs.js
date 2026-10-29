import { z } from 'zod';
import { getPRWorkflowLogs } from '../../github.js';
import {
  DEFAULT_LOG_BYTES,
  MAX_LOG_RANGE_BYTES,
  validateLogByteRange,
} from '../../mcp-pagination.js';
import { ok, fail } from '../lib/result.js';

export function createPrWorkflowLogsTool(ctx) {
  const { getSession, getToken, requireGitHubRepo } = ctx;
  return {
    name: 'PrWorkflowLogs',
    description: `Get logs for a workflow run job. Pass job_id or job_name (from PrWorkflows run jobs) to read one job; otherwise returns failed jobs when any failed, else all jobs. Defaults to the last ${DEFAULT_LOG_BYTES} bytes. When endByte is omitted, returns max(${MAX_LOG_RANGE_BYTES}, bytes from startByte through EOF). When both startByte and endByte are set, the range is capped at ${MAX_LOG_RANGE_BYTES} bytes. Negative indices count from the end; do not combine a negative startByte with a non-negative endByte.`,
    schema: {
      runId: z.string().describe('Workflow run ID from PrWorkflows'),
      jobId: z
        .string()
        .optional()
        .describe('Actions job id from PrWorkflows (fetch logs for this job only)'),
      jobName: z
        .string()
        .optional()
        .describe('Actions job name from PrWorkflows (fetch logs for this job only)'),
      allJobs: z
        .boolean()
        .optional()
        .describe(
          'When true and job_id/job_name are omitted, include every job in the run (default: failed jobs only when any failed)'
        ),
      startByte: z
        .number()
        .optional()
        .describe(
          `Start byte (0-based). Negative values count from the end. Omit both bounds for the last ${DEFAULT_LOG_BYTES} bytes.`
        ),
      endByte: z
        .number()
        .optional()
        .describe(
          `Inclusive end byte (optional). Negative values count from the end. When omitted, end is startByte + max(${MAX_LOG_RANGE_BYTES}, bytes remaining until EOF). Must be negative if startByte is negative.`
        ),
    },
    handler: async ({ runId, jobId, jobName, allJobs, startByte, endByte }) => {
      const localErr = await requireGitHubRepo();
      if (localErr) return localErr;
      const validationError = validateLogByteRange({ startByte, endByte });
      if (validationError) return fail(validationError);
      const session = await getSession();
      try {
        const result = await getPRWorkflowLogs(await getToken(), session.repo_full_name, runId, {
          startByte,
          endByte,
          jobId,
          jobName,
          allJobs,
        });
        return ok(result);
      } catch (err) {
        return fail(err.message || String(err));
      }
    },
  };
}
