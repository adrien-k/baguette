import { z } from 'zod';

export const loopScheduleSchema = {
  schedule_type: z.enum(['interval', 'daily', 'weekly']).describe('Recurrence type'),
  interval_minutes: z.number().int().optional().describe('For schedule_type interval'),
  time_of_day: z.string().optional().describe('HH:MM for daily/weekly schedules'),
  days_of_week: z
    .array(z.number().int().min(0).max(6))
    .optional()
    .describe('0=Sunday … 6=Saturday, for weekly'),
  timezone: z.string().optional().describe('IANA timezone, e.g. America/New_York'),
};

export const loopPatchSchema = {
  name: z.string().optional(),
  base_branch: z.string().optional(),
  prompt: z.string().optional(),
  create_new_branch: z.boolean().optional(),
  auto_push: z.boolean().optional(),
  single_session: z.boolean().optional(),
  agent_sdk: z.enum(['claude', 'cursor', 'pi']).optional(),
  model: z.string().optional(),
  model_params: z.string().optional(),
  plugins: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  is_global: z.boolean().optional(),
  ...loopScheduleSchema,
};
