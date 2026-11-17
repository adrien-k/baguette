import { z } from 'zod';
import { ISSUE_STATUSES } from '../../session-issues.js';
import { createIssueHandlers } from '../lib/issue-handlers.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';

const DESCRIPTION =
  'List session review issues. Optional status filter (needs_decision, opened, submitted, ignored, resolved). ' +
  'needs_decision issues are waiting for the user to choose an approach and are not part of fix-all. ' +
  'session_id is required (from CurrentSessionInfo or GetSession). Issues are numbered by ref within the session.';

export function createListIssuesTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'ListIssues',
    description: DESCRIPTION,
    schema: {
      session_id: z.number().int().describe('Session id'),
      status: z.enum(ISSUE_STATUSES).optional().describe('Filter by status'),
    },
    handler: async (args) => {
      const { session, result: sessionError } = await requireMcpSession(
        app,
        args.session_id,
        userId
      );
      if (sessionError) return sessionError;
      return createIssueHandlers(session, app).listIssues(args);
    },
  };
}
