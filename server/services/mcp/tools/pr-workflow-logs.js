import { z } from 'zod';
import { getPRWorkflowLogs } from '../../github.js';
import { validateLogByteRange } from '../../mcp-pagination.js';
import { ok, fail } from '../lib/result.js';

export function createPrWorkflowLogsTool(ctx) {
  const { getSession, getToken, requireGitHubRepo } = ctx;
  return {
    name: 'PrWorkflowLogs',
    description:
      'Get logs for a workflow run. Defaults to the last 5000 bytes. When endByte is omitted, returns max(5000, bytes from startByte through EOF). When both startByte and endByte are set, the range is capped at 5000 bytes. Negative indices count from the end; do not combine a negative startByte with a non-negative endByte.',
    schema: {
      runId: z.string().describe('Workflow run ID from PrWorkflows'),
      startByte: z
        .number()
        .optional()
        .describe(
          'Start byte (0-based). Negative values count from the end. Omit both bounds for the last 5000 bytes.'
        ),
      endByte: z
        .number()
        .optional()
        .describe(
          'Inclusive end byte (optional). Negative values count from the end. When omitted, end is startByte + max(5000, bytes remaining until EOF). Must be negative if startByte is negative.'
        ),
    },
    handler: async ({ runId, startByte, endByte }) => {
      const localErr = await requireGitHubRepo();
      if (localErr) return localErr;
      const validationError = validateLogByteRange({ startByte, endByte });
      if (validationError) return fail(validationError);
      const session = await getSession();
      const result = await getPRWorkflowLogs(await getToken(), session.repo_full_name, runId, {
        startByte,
        endByte,
      });
      return ok(result);
    },
  };
}
