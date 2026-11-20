import { z } from 'zod';
import { ISSUE_SEVERITIES, REVIEWER_UPDATE_STATUSES } from '../../session-issues.js';
import { updateIssueOptionsSchema } from '../lib/issue-option-schema.js';
import { createIssueHandlers } from '../lib/issue-handlers.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';

const issueRefSchema = z
  .number()
  .int()
  .min(1)
  .describe('Issue ref (session-relative number from ListIssues)');

export function createUpdateIssueTool(ctx, { allowStatus = true } = {}) {
  const { app, userId } = ctx;
  const schema = {
    session_id: z.number().int().describe('Session id'),
    ref: issueRefSchema,
    severity: z.enum(ISSUE_SEVERITIES).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    options: updateIssueOptionsSchema,
    selected_option_id: z
      .string()
      .optional()
      .describe(
        'After the user picks an approach on a needs_decision issue (e.g. via AskUserQuestions), pass the option id from ReadIssue. Records the choice via selectOption; do not combine with other fields in the same call.'
      ),
  };
  if (allowStatus) schema.status = z.enum(REVIEWER_UPDATE_STATUSES).optional();
  const description = allowStatus
    ? 'Update an existing review issue (severity, title, description, status, and/or options). Non-empty options set status needs_decision. An empty options array clears options and reopens a needs_decision issue unless status is set to something else. Use selected_option_id alone to record the user’s choice on a needs_decision issue. session_id is required.'
    : 'Update an existing review issue (severity, title, description, options, and/or selected_option_id). Does not change status — use UpdateIssueStatus for ignored or resolved. Non-empty options set status needs_decision. Use selected_option_id alone after AskUserQuestions to record which option the user chose (id from ReadIssue). session_id is required.';
  return {
    name: 'UpdateIssue',
    description,
    schema,
    handler: async (args) => {
      const { session, result: sessionError } = await requireMcpSession(
        app,
        args.session_id,
        userId
      );
      if (sessionError) return sessionError;
      const payload = { ...args };
      if (!allowStatus) delete payload.status;
      return createIssueHandlers(session, app).updateIssue(payload);
    },
  };
}
