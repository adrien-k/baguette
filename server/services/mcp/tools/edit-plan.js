import { z } from 'zod';

const planPatchSchema = z.object({
  old_string: z
    .string()
    .min(1)
    .describe('Exact substring of the current stored plan to replace (must match once)'),
  new_string: z.string().describe('Replacement text; use empty string to delete old_string'),
});

export function createEditPlanTool(h) {
  return {
    name: 'EditPlan',
    description:
      'Patch the session plan stored in the database. Send one or more { old_string, new_string } edits; the server applies them to the saved plan in order—do not resend the full plan markdown. Summarize in patches; reference todos by id or title. Shows the updated plan in chat and ends your turn—do not add a follow-up assistant message (if required, say only “Plan updated.”). Requires CreatePlan first.',
    schema: {
      patches: z
        .array(planPatchSchema)
        .min(1)
        .describe(
          'Ordered patches against the stored plan. Copy old_string exactly from the current plan (e.g. from ReadPlan or a prior CreatePlan result).'
        ),
    },
    handler: h.editPlan,
  };
}
