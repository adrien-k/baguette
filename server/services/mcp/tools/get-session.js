import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { resolveOwnedSession, summarizeAssistantMessage } from '../lib/session-resolution.js';
import { collectLastFailedTasks } from '../lib/task-helpers.js';

export function createGetSessionTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'GetSession',
    description:
      'Get one session with details, message count, initial_prompt, and the most recent assistant message. ' +
      'Accepts session_id or short_id (other MCP tools use session_id only).',
    schema: {
      session_id: z.number().int().optional().describe('Session numeric id'),
      short_id: z
        .string()
        .optional()
        .describe('Session short id (8 hex characters, from URLs and CurrentSessionInfo)'),
    },
    handler: async (args) => {
      if (args.session_id == null && !args.short_id?.trim()) {
        return fail('Provide session_id or short_id');
      }
      const session = await resolveOwnedSession(app, args, userId);
      if (!session) return fail('Session not found');

      const session_id = session.id;
      const db = app.get('db');
      const { count } = await db('session_messages')
        .where({ session_id })
        .count('* as count')
        .first();
      const messageCount = Number(count ?? 0);

      const lastAssistant = await db('session_messages')
        .where({ session_id })
        .whereIn('type', ['assistant'])
        .orderBy('id', 'desc')
        .first();

      const tasksService = app.service('tasks');
      const last_failed_tasks = tasksService?.listTasksForSession
        ? collectLastFailedTasks(tasksService, session_id)
        : [];

      return ok({
        session,
        message_count: messageCount,
        initial_prompt: session.initial_prompt ?? null,
        last_assistant_message: summarizeAssistantMessage(lastAssistant),
        last_failed_tasks,
      });
    },
  };
}
