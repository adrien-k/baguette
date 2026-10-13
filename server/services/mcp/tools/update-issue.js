import { z } from 'zod';
import { ISSUE_SEVERITIES, REVIEWER_UPDATE_STATUSES } from '../../session-issues.js';
import { createIssueHandlers } from '../lib/issue-handlers.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';

const issueRefSchema = z
  .number()
  .int()
  .min(1)
  .describe('Issue ref (session-relative number from ListIssues)');

export function createUpdateIssueTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'UpdateIssue',
    description:
      'Update an existing review issue (severity, title, description, and/or status). session_id is required.',
    schema: {
      session_id: z.number().int().describe('Session id'),
      ref: issueRefSchema,
      severity: z.enum(ISSUE_SEVERITIES).optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(REVIEWER_UPDATE_STATUSES).optional(),
    },
    handler: async (args) => {
      const { session, result: sessionError } = await requireMcpSession(
        app,
        args.session_id,
        userId
      );
      if (sessionError) return sessionError;
      return createIssueHandlers(session, app).updateIssue(args);
    },
  };
}
