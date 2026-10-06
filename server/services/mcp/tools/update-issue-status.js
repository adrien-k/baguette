import { z } from 'zod';
import { AGENT_ISSUE_STATUSES } from '../../session-issues.js';

const issueIdSchema = z.number().int().describe('Issue id');

export function createUpdateIssueStatusTool(h) {
  return {
    name: 'UpdateIssueStatus',
    description:
      'Set a session review issue to ignored or resolved after you have handled it. Do not use opened.',
    schema: {
      issue_id: issueIdSchema,
      status: z.enum(AGENT_ISSUE_STATUSES).describe('ignored or resolved'),
    },
    handler: h.updateIssueStatus,
  };
}
