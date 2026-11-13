import { z } from 'zod';

export function createStartPlanTool(h) {
  return {
    name: 'StartPlan',
    description:
      'Attach this agent to a session plan by setting `current_plan_id`. Pass `plan_id` or `ref` (from CreatePlan or ListPlans). Idempotent if already on that plan; switching plans updates the current plan without completing the previous one. CreatePlan does not attach — call StartPlan after creating (including after the user clicks Run the plan, which only sends a message). If this turn has no CreatePlan result, call ListPlans first. Fails if the plan is missing or completed.',
    schema: {
      plan_id: z
        .number()
        .int()
        .optional()
        .describe('Plan id from CreatePlan. Provide plan_id or ref.'),
      ref: z
        .number()
        .int()
        .optional()
        .describe('Session-relative plan ref. Provide plan_id or ref.'),
    },
    handler: h.startPlan,
  };
}
