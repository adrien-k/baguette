import { z } from 'zod';

export function createListPlansTool(h) {
  return {
    name: 'ListPlans',
    description:
      'List session plans (`id`, `ref`, `status`, `markdown`). Optional `status` filter (`open` or `completed`). Also returns this agent’s `current_plan_id` (null if unattached). Use after **Run the plan** (message only) to recover `plan_id`/`ref` for StartPlan when CreatePlan results are not in this turn.',
    schema: {
      status: z.enum(['open', 'completed']).optional().describe('Filter by plan status'),
    },
    handler: h.listPlans,
  };
}
