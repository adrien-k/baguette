import { z } from 'zod';

export function createCreatePlanTool(h) {
  return {
    name: 'CreatePlan',
    description:
      'Create the session plan (markdown). Summarize approach and reference todos by ref or short title—do not paste full todo bodies. Shows the plan in chat. When `interactive` is true (default), pause for user review—end your turn right after this tool returns with no follow-up message (if required, say only “Plan created.”). Set `interactive: false` to keep running in the same turn (e.g. orchestration agents that create plan+todos then delegate via StartSubagent). Use once per session; use EditPlan to revise.',
    schema: {
      markdown: z
        .string()
        .describe('Plan markdown: goals, order, and todo references—not duplicate todo content.'),
      interactive: z
        .boolean()
        .optional()
        .describe(
          'When true (default), pause for user approval (“Run the plan”). When false, persist the plan and continue the turn without waiting.'
        ),
    },
    handler: h.createPlan,
  };
}
