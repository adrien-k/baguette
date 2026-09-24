import { z } from 'zod';
import { ok, fail } from './baguette-mcp-tool-result.js';

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

const loopPatchSchema = {
  name: z.string().optional(),
  base_branch: z.string().optional(),
  prompt: z.string().optional(),
  create_new_branch: z.boolean().optional(),
  auto_push: z.boolean().optional(),
  plan_mode: z.boolean().optional(),
  single_session: z.boolean().optional(),
  agent_sdk: z.enum(['claude', 'cursor']).optional(),
  model: z.string().optional(),
  model_params: z.string().optional(),
  plugins: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  is_global: z.boolean().optional(),
  ...loopScheduleSchema,
};

export function buildBaguetteLoopMcpTools(user, app) {
  const userId = user.id;
  const userParams = { provider: 'rest', user: { id: userId } };

  return [
    {
      name: 'ListLoops',
      description: 'List your scheduled session loops, newest first.',
      schema: {
        repo_full_name: z.string().optional().describe('Filter by repository full name'),
        is_global: z.boolean().optional().describe('Filter to global loops'),
      },
      handler: async ({ repo_full_name, is_global } = {}) => {
        const query = {};
        if (repo_full_name) query.repo_full_name = repo_full_name;
        if (is_global) query.is_global = true;
        const result = await app.service('loops').find({ ...userParams, query });
        const loops = Array.isArray(result) ? result : (result?.data ?? []);
        return ok({ loops });
      },
    },

    {
      name: 'GetLoop',
      description: 'Get a single loop by id.',
      schema: { loop_id: z.number().int() },
      handler: async ({ loop_id }) => {
        try {
          const loop = await app.service('loops').get(loop_id, userParams);
          return ok({ loop });
        } catch (err) {
          return fail(err.message ?? 'Loop not found');
        }
      },
    },

    {
      name: 'CreateLoop',
      description:
        'Create a recurring session loop (same fields as the dashboard loop form). Requires prompt and schedule fields. Pass is_global for a global loop, or repo_full_name and base_branch for a repo loop.',
      schema: {
        repo_full_name: z.string().optional(),
        is_global: z.boolean().optional(),
        base_branch: z.string().optional(),
        prompt: z.string(),
        ...loopPatchSchema,
      },
      handler: async (data) => {
        try {
          const loop = await app.service('loops').create(data, userParams);
          return ok({ loop });
        } catch (err) {
          return fail(err.message);
        }
      },
    },

    {
      name: 'UpdateLoop',
      description: 'Patch an existing loop. Only include fields to change.',
      schema: {
        loop_id: z.number().int(),
        repo_full_name: z.string().optional(),
        ...loopPatchSchema,
      },
      handler: async ({ loop_id, ...patch }) => {
        try {
          const loop = await app.service('loops').patch(loop_id, patch, userParams);
          return ok({ loop });
        } catch (err) {
          return fail(err.message);
        }
      },
    },

    {
      name: 'DeleteLoop',
      description: 'Delete a loop permanently.',
      schema: { loop_id: z.number().int() },
      handler: async ({ loop_id }) => {
        try {
          await app.service('loops').remove(loop_id, userParams);
          return ok({ deleted: true, loop_id });
        } catch (err) {
          return fail(err.message);
        }
      },
    },
  ];
}
