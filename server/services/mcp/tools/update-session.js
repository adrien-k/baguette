import { z } from 'zod';
import { ok, fail } from '../lib/result.js';

export function createUpdateSessionTool(ctx) {
  const { patchSession } = ctx;
  return {
    name: 'UpdateSession',
    description:
      'Update this session’s title (`label`) and/or `description` in Baguette. Baguette syncs these to GitHub after the turn ends (when auto-push is on). Call **`CurrentSessionInfo`** to read the current values before updating. The description must reflect the **entire** branch diff against the base branch, not only this turn. **Follow the repo GitHub PR template** when one exists; otherwise use ## Why, ## Summary (bullet lists for the full branch), and ## Test plan (only critical manual cases automated tests cannot cover).',
    schema: {
      label: z.string().optional().describe('Session title / PR title'),
      description: z.string().optional().describe('Also used as the pull request description.'),
    },
    handler: async ({ label, description }) => {
      const patch = {};
      if (label !== undefined) patch.label = label;
      if (description !== undefined) patch.pr_description = description;
      if (!Object.keys(patch).length) {
        return fail('Provide at least one of label or description.');
      }
      await patchSession(patch);
      return ok({ message: 'Session updated.' });
    },
  };
}
