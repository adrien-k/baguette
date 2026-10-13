import { z } from 'zod';
import { createIssueHandlers } from '../lib/issue-handlers.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';

const issueRefSchema = z
  .number()
  .int()
  .min(1)
  .describe('Issue ref (session-relative number from ListIssues)');

export function createCloseIssueTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'CloseIssue',
    description:
      'Close an issue after review (archived; hidden from ListIssues). Required after reviewing each resolved issue (whether fixed or not). If still broken, CreateIssue a new opened finding after closing. session_id is required.',
    schema: {
      session_id: z.number().int().describe('Session id'),
      ref: issueRefSchema,
    },
    handler: async (args) => {
      const { session, result: sessionError } = await requireMcpSession(
        app,
        args.session_id,
        userId
      );
      if (sessionError) return sessionError;
      return createIssueHandlers(session, app).closeIssue(args);
    },
  };
}
