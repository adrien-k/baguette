import { z } from 'zod';

export const issueOptionSchema = z.object({
  id: z.string().min(1).describe('Stable id for this approach'),
  title: z.string().min(1).describe('Short name of the approach'),
  description: z
    .string()
    .optional()
    .describe('Concrete impact: tradeoffs, migration cost, or risk'),
});

const OPTIONS_HINT =
  'Prefer omitting options when the best fix is obvious. Pass 2–5 approaches only when several are genuinely viable and the user should choose (breaking changes, data loss, security or architecture tradeoffs). Non-empty options set status needs_decision.';

export const createIssueOptionsSchema = z
  .array(issueOptionSchema)
  .min(2)
  .max(5)
  .optional()
  .describe(OPTIONS_HINT);

export const updateIssueOptionsSchema = z
  .array(issueOptionSchema)
  .max(5)
  .refine((items) => items.length === 0 || items.length >= 2, {
    message: 'options must be empty or contain 2 to 5 items',
  })
  .optional()
  .describe(`${OPTIONS_HINT} Pass an empty array to clear options.`);
