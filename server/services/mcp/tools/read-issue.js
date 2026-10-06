import { z } from 'zod';
import { fail } from '../lib/result.js';
import { resolveTargetSession } from '../lib/session-resolution.js';
import { createIssueHandlers } from '../lib/issue-handlers.js';

const issueIdSchema = z.number().int().describe('Issue id');

const DESCRIPTION =
  'Read one session review issue by id. ' +
  'When running inside a repo session, omit session_id to use the current session. ' +
  'Otherwise pass session_id (from GetSession or SearchSessions).';

export function createReadIssueTool(ctx) {
  const { app, userId, callerSession } = ctx;
  return {
    name: 'ReadIssue',
    description: DESCRIPTION,
    schema: {
      issue_id: issueIdSchema,
      session_id: z.number().int().optional().describe('Session id (defaults to current session)'),
    },
    handler: async ({ issue_id, session_id }) => {
      const session = await resolveTargetSession(app, session_id, userId, callerSession);
      if (!session) return fail('Session not found. Provide session_id.');
      return createIssueHandlers(session, app).readIssue({ issue_id });
    },
  };
}
