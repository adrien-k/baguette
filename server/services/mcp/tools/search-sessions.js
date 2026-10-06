import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { SESSION_LIST_COLUMNS, applySessionSearchFilters } from '../lib/session-resolution.js';

export function createSearchSessionsTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'SearchSessions',
    description:
      'Search your sessions with optional filters. Matches label and initial_prompt for `q`. `remote_branch` matches the shared PR/push head. `target_branch` matches local_branch or remote_branch.',
    schema: {
      repo_id: z.number().int().optional().describe('Filter by repository id from ListRepos'),
      is_global: z.boolean().optional().describe('Filter to global sessions'),
      q: z.string().optional().describe('Search in session label and initial_prompt'),
      base_branch: z.string().optional(),
      remote_branch: z
        .string()
        .optional()
        .describe('Filter by shared remote/PR branch (multiple sessions may match)'),
      target_branch: z.string().optional().describe('Matches local_branch or remote_branch'),
      created_after: z.string().optional().describe('ISO timestamp — sessions created at or after'),
      created_before: z
        .string()
        .optional()
        .describe('ISO timestamp — sessions created at or before'),
      loop_id: z.number().int().optional().describe('Filter sessions spawned by this loop'),
      include_archived: z
        .boolean()
        .optional()
        .describe('Include archived sessions (default false)'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results (default 50)'),
    },
    handler: async (args) => {
      if (args.repo_id != null) {
        const db = app.get('db');
        const linked = await db('user_repos')
          .where({ user_id: userId, repo_id: args.repo_id })
          .first();
        if (!linked)
          return fail(`Repository ${args.repo_id} not found or not linked to your account.`);
      }
      const db = app.get('db');
      const limit = args.limit ?? 50;
      let query = db('sessions').select(...SESSION_LIST_COLUMNS);
      query = applySessionSearchFilters(query, args, userId);
      const sessions = await query
        .orderByRaw('CASE WHEN sessions.archived_at IS NOT NULL THEN 1 ELSE 0 END ASC')
        .orderBy('sessions.last_activity_at', 'desc')
        .limit(limit);
      return ok({ sessions, count: sessions.length });
    },
  };
}
