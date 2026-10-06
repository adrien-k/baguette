import { z } from 'zod';

const issueIdSchema = z.number().int().describe('Issue id');

export function createCloseIssueTool(h) {
  return {
    name: 'CloseIssue',
    description:
      'Close an issue after review (archived; hidden from ListIssues). Required after reviewing each resolved issue (whether fixed or not). If still broken, CreateIssue a new opened finding after closing.',
    schema: {
      issue_id: issueIdSchema,
    },
    handler: h.closeIssue,
  };
}
