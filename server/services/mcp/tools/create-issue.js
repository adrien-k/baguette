import { z } from 'zod';
import { ISSUE_SEVERITIES } from '../../session-issues.js';
import { createIssueOptionsSchema } from '../lib/issue-option-schema.js';

export function createCreateIssueTool(h) {
  return {
    name: 'CreateIssue',
    description:
      'Open a new review issue on this session. Severity is critical, high, medium, or low. ' +
      'Prefer an issue with no options when the best fix is obvious. Pass options only when several ' +
      'approaches are genuinely viable and the user should choose; non-empty options set status needs_decision.',
    schema: {
      severity: z.enum(ISSUE_SEVERITIES).describe('Issue severity'),
      title: z.string().describe('Short issue title'),
      description: z.string().optional().describe('Details, including file paths'),
      options: createIssueOptionsSchema,
    },
    handler: h.createIssue,
  };
}
