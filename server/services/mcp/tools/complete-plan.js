import { z } from 'zod';

export function createCompletePlanTool(h) {
  return {
    name: 'CompletePlan',
    description:
      "Mark a session plan `completed` and clear `current_plan_id` on every agent attached to it. Defaults to this agent's current plan. Optional `plan_id` or `ref`. Does not pause the turn.",
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
    handler: h.completePlan,
  };
}
