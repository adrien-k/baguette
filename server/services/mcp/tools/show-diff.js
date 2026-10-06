import { z } from 'zod';
import { ok } from '../lib/result.js';

export function createShowDiffTool() {
  return {
    name: 'ShowDiff',
    description: 'Display the git diff for a file visually to the user in a diff viewer.',
    schema: {
      path: z.string().describe('File path (relative to worktree root) to show diff for'),
    },
    handler: async ({ path: filePath }) => {
      // Diff is fetched client-side via sessionsService.showDiff — nothing returned to agent
      return ok({ path: filePath });
    },
  };
}
