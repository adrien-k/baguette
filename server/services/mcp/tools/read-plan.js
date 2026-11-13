import { z } from 'zod';

export function createReadPlanTool(h) {
  return {
    name: 'ReadPlan',
    description:
      "Read a session plan stored in the database. Defaults to this agent's current plan; optional `plan_id` or `ref`. Use before EditPlan to copy old_string snippets exactly, or when you need the current plan text mid-turn.",
    schema: {
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
    },
    handler: h.readPlan,
  };
}
