import { z } from 'zod';
import { getPRWorkflowLogs } from '../../github.js';
import {
  DEFAULT_LOG_BYTES,
  MAX_LOG_RANGE_BYTES,
  validateLogByteRange,
} from '../../mcp-pagination.js';
import { ok, fail } from '../lib/result.js';

export function createPrWorkflowLogsTool(ctx) {
  const { resolveReadTargetSession, requireGitHubApiForSession, getToken } = ctx;
  return {
    name: 'PrWorkflowLogs',
    description:
      `Get logs for a workflow run job. Pass job_id or job_name (from PrWorkflows run jobs) to read one job; otherwise returns failed jobs when any failed, else all jobs. Defaults to the last ${DEFAULT_LOG_BYTES} bytes. Any request without an explicit endByte is capped at ${MAX_LOG_RANGE_BYTES} bytes, so a call can never return an entire large log inline. Use totalBytes from the response to plan follow-up byte-range reads (walk backwards in 64–128KB steps). Never fetch CI logs without a byte range; start with a tail read (startByte: -65536, endByte: -1). Results over 128KB are spilled to a file under .data/tool-results/ — grep or read that file in chunks instead. When both startByte and endByte are set, the range is capped at ${MAX_LOG_RANGE_BYTES} bytes. Negative indices count from the end; do not combine a negative startByte with a non-negative endByte. ` +
      'When running inside a repo session, omit session_id to read its PR. From a global session or when triaging another session, pass session_id (from GetSession or SearchSessions).',
    schema: {
      session_id: z.number().int().optional().describe('Target repo session id'),
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
          `Inclusive end byte (optional). Negative values count from the end. When omitted, the window is capped at ${MAX_LOG_RANGE_BYTES} bytes from startByte. Must be negative if startByte is negative.`
        ),
    },
    handler: async ({ session_id, runId, jobId, jobName, allJobs, startByte, endByte }) => {
      const { session, error } = await resolveReadTargetSession(session_id);
      if (error) return fail(error);
      const localErr = await requireGitHubApiForSession(session);
      if (localErr) return localErr;
      const validationError = validateLogByteRange({ startByte, endByte });
      if (validationError) return fail(validationError);
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
