import { z } from 'zod';

export function createCreatePlanTool(h) {
  return {
    name: 'CreatePlan',
    description:
      'Create the session plan (markdown). Summarize approach and reference todos by ref or short title—do not paste full todo bodies. Shows the plan in chat; end your turn right after this tool returns—no follow-up message (if required, say only “Plan created.”). Use once per session; use EditPlan to revise.',
    schema: {
      markdown: z
        .string()
        .describe('Plan markdown: goals, order, and todo references—not duplicate todo content.'),
    },
    handler: h.createPlan,
  };
}
