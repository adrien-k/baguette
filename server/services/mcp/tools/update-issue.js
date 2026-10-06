import { z } from 'zod';
import { ISSUE_SEVERITIES, REVIEWER_UPDATE_STATUSES } from '../../session-issues.js';

const issueIdSchema = z.number().int().describe('Issue id');

export function createUpdateIssueTool(h) {
  return {
    name: 'UpdateIssue',
    description: 'Update an existing review issue (severity, title, description, and/or status).',
    schema: {
      issue_id: issueIdSchema,
      severity: z.enum(ISSUE_SEVERITIES).optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(REVIEWER_UPDATE_STATUSES).optional(),
    },
    handler: h.updateIssue,
  };
}
