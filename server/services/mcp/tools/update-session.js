import { z } from 'zod';
import { ok, fail } from '../lib/result.js';

export function createUpdateSessionTool(ctx) {
  const { patchSession } = ctx;
  return {
    name: 'UpdateSession',
    description:
      'Update this session’s title (`label`), pull request `description`, and/or diff/PR `base_branch` in Baguette. Baguette syncs title and description to GitHub after the turn ends (when auto-push is on); changing `base_branch` updates the stored diff base immediately and applies to the GitHub PR on the next push. Call **`CurrentSessionInfo`** to read the current values before updating. The description must reflect the **entire** branch diff against the base branch, not only this turn. **Follow the repo GitHub PR template** when one exists; otherwise use ## Why, ## Summary (bullet lists for the full branch), and ## Test plan (only critical manual cases automated tests cannot cover).',
    schema: {
      label: z.string().optional().describe('Session title / PR title'),
      description: z.string().optional().describe('Also used as the pull request description.'),
      base_branch: z
        .string()
        .optional()
        .describe(
          'Git branch to diff against and use as the GitHub PR base (repo sessions only). Synced to the PR on push.'
        ),
    },
    handler: async ({ label, description, base_branch }) => {
      const patch = {};
      if (label !== undefined) patch.label = label;
      if (description !== undefined) patch.pr_description = description;
      if (base_branch !== undefined) {
        if (ctx.session.is_global) {
          return fail('Global sessions do not have a base branch.');
        }
        const trimmed = base_branch.trim();
        if (!trimmed) {
          return fail('base_branch cannot be empty.');
        }
        patch.base_branch = trimmed;
      }
      if (!Object.keys(patch).length) {
        return fail('Provide at least one of label, description, or base_branch.');
      }
      await patchSession(patch);
      return ok({ message: 'Session updated.' });
    },
  };
}
