import { z } from 'zod';
import { agentCreatedModelSchemaFields } from './agent-created-model-fields.js';

const loopScheduleSchema = {
  schedule_type: z.enum(['interval', 'daily', 'weekly']).describe('Recurrence type'),
  interval_minutes: z.number().int().optional().describe('For schedule_type interval'),
  time_of_day: z.string().optional().describe('HH:MM for daily/weekly schedules'),
  days_of_week: z
    .array(z.number().int().min(0).max(6))
    .optional()
    .describe('0=Sunday … 6=Saturday, for weekly'),
  timezone: z.string().optional().describe('IANA timezone, e.g. America/New_York'),
};

function loopBodySchema(modelFields) {
  return {
    name: z.string().optional(),
    base_branch: z.string().optional(),
    prompt: z.string().optional(),
    create_new_branch: z.boolean().optional(),
    auto_push: z.boolean().optional(),
    single_session: z.boolean().optional(),
    ...modelFields,
    plugins: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    is_global: z.boolean().optional(),
    is_shared: z
      .boolean()
      .optional()
      .describe('When true, every authenticated user on this instance can open the loop'),
    ...loopScheduleSchema,
  };
}

/** CreateLoop: creation must satisfy the Agent-created model policy (e.g. a preset in Presets-only mode). */
export function loopCreateSchema(mode) {
  return loopBodySchema(agentCreatedModelSchemaFields(mode));
}

/** UpdateLoop: nothing but loop_id is required, and an unrelated patch never needs model fields. */
export function loopPatchSchema(mode) {
  return loopBodySchema(agentCreatedModelSchemaFields(mode, { patch: true }));
}
