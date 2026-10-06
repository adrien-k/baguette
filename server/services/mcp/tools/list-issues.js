import { z } from 'zod';
import { ISSUE_STATUSES } from '../../session-issues.js';
import { fail } from '../lib/result.js';
import { resolveTargetSession } from '../lib/session-resolution.js';
import { createIssueHandlers } from '../lib/issue-handlers.js';

const DESCRIPTION =
  'List session review issues. Optional status filter (opened, submitted, ignored, resolved). ' +
  'When running inside a repo session, omit session_id to use the current session. ' +
  'Otherwise pass session_id (from GetSession or SearchSessions).';

export function createListIssuesTool(ctx) {
  const { app, userId, callerSession } = ctx;
  return {
    name: 'ListIssues',
    description: DESCRIPTION,
    schema: {
      status: z.enum(ISSUE_STATUSES).optional().describe('Filter by status'),
      session_id: z.number().int().optional().describe('Session id (defaults to current session)'),
    },
    handler: async (args) => {
      const session = await resolveTargetSession(app, args.session_id, userId, callerSession);
      if (!session) return fail('Session not found. Provide session_id.');
      return createIssueHandlers(session, app).listIssues(args);
    },
  };
}
