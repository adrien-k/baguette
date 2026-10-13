import { z } from 'zod';
import { AGENT_ISSUE_STATUSES } from '../../session-issues.js';
import { createIssueHandlers } from '../lib/issue-handlers.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';

const issueRefSchema = z
  .number()
  .int()
  .min(1)
  .describe('Issue ref (session-relative number from ListIssues)');

export function createUpdateIssueStatusTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'UpdateIssueStatus',
    description:
      'Set a session review issue to ignored or resolved after you have handled it. Do not use opened. session_id is required.',
    schema: {
      session_id: z.number().int().describe('Session id'),
      ref: issueRefSchema,
      status: z.enum(AGENT_ISSUE_STATUSES).describe('ignored or resolved'),
    },
    handler: async (args) => {
      const { session, result: sessionError } = await requireMcpSession(
        app,
        args.session_id,
        userId
      );
      if (sessionError) return sessionError;
      return createIssueHandlers(session, app).updateIssueStatus(args);
    },
  };
}
