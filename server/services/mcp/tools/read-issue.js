import { z } from 'zod';
import { createIssueHandlers } from '../lib/issue-handlers.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';

const issueRefSchema = z
  .number()
  .int()
  .min(1)
  .describe('Issue ref (session-relative number from ListIssues)');

const DESCRIPTION =
  'Read one session review issue by ref. session_id is required (from CurrentSessionInfo or GetSession).';

export function createReadIssueTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'ReadIssue',
    description: DESCRIPTION,
    schema: {
      session_id: z.number().int().describe('Session id'),
      ref: issueRefSchema,
    },
    handler: async ({ ref, session_id }) => {
      const { session, result: sessionError } = await requireMcpSession(app, session_id, userId);
      if (sessionError) return sessionError;
      return createIssueHandlers(session, app).readIssue({ ref });
    },
  };
}
