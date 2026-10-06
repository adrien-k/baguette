import { z } from 'zod';
import { ISSUE_SEVERITIES } from '../../session-issues.js';

export function createCreateIssueTool(h) {
  return {
    name: 'CreateIssue',
    description:
      'Open a new review issue on this session. Severity is critical, high, medium, or low.',
    schema: {
      severity: z.enum(ISSUE_SEVERITIES).describe('Issue severity'),
      title: z.string().describe('Short issue title'),
      description: z.string().optional().describe('Details, including file paths'),
    },
    handler: h.createIssue,
  };
}
