import { z } from 'zod';

export function createCreatePlanTool(h) {
  return {
    name: 'CreatePlan',
    description:
      'Create a new session plan (markdown). Always inserts a new row; does not attach this agent — call StartPlan to set `current_plan_id`. Summarize approach and reference todos by ref or short title—do not paste full todo bodies. Shows the plan in chat. When `interactive` is true (default), pause for user review—end your turn right after this tool returns with no follow-up message (if required, say only “Plan created.”). Set `interactive: false` to keep running in the same turn (e.g. orchestration agents that create plan+todos then delegate via StartSubagent). Use EditPlan to revise an existing plan.',
    schema: {
      markdown: z
        .string()
        .describe('Plan markdown: goals, order, and todo references—not duplicate todo content.'),
      interactive: z
        .boolean()
        .optional()
        .describe(
          'When true (default), pause for user approval (“Run the plan”). Run the plan only sends a follow-up message — call StartPlan yourself to attach. When false, persist the plan and continue the turn without waiting.'
        ),
    },
    handler: h.createPlan,
  };
}
