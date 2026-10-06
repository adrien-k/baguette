import { z } from 'zod';
import { ok } from '../lib/result.js';

export function createUpdateSessionTool(ctx) {
  const { patchSession } = ctx;
  return {
    name: 'UpdateSession',
    description:
      'Rename the session in the UI (database only, no GitHub). Use when no pull request is intended yet. Title and PR description for shipping work come from PrUpsert.',
    schema: {
      label: z.string().describe('Session label / title'),
    },
    handler: async ({ label }) => {
      await patchSession({ label });
      return ok({ message: 'Session label updated.' });
    },
  };
}
