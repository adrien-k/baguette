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
      "Patch a session plan stored in the database. Defaults to this agent's current plan; optional `plan_id` or `ref`. Send one or more { old_string, new_string } edits; the server applies them to the saved plan in order—do not resend the full plan markdown. Summarize in patches; reference todos by ref or title. Shows the updated plan in chat. When `interactive` is true (default), pause for user review—end your turn right after this tool returns with no follow-up message (if required, say only “Plan updated.”). Set `interactive: false` to keep running in the same turn.",
    schema: {
      patches: z
        .array(planPatchSchema)
        .min(1)
        .describe(
          'Ordered patches against the stored plan. Copy old_string exactly from the current plan (e.g. from ReadPlan or a prior CreatePlan result).'
        ),
      plan_id: z
        .number()
        .int()
        .optional()
        .describe("Plan id. Defaults to this agent's current plan."),
      ref: z
        .number()
        .int()
        .optional()
        .describe("Session-relative plan ref. Defaults to this agent's current plan."),
      interactive: z
        .boolean()
        .optional()
        .describe(
          'When true (default), pause for user approval (“Run the plan”). Run the plan only sends a follow-up message — call StartPlan yourself to attach. When false, persist the plan and continue the turn without waiting.'
        ),
    },
    handler: h.editPlan,
  };
}
