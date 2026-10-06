import { z } from 'zod';
import { isTaskActive } from '../../../../shared/task-status.js';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';

export function createListRunningTasksTool(ctx) {
  const { app, userId, callerSession } = ctx;
  return {
    name: 'ListRunningTasks',
    description:
      'List currently running baguette tasks for a session, including labels, task_key, and assigned ports. ' +
      'Omit session_id in a repo session for the current session; pass session_id when triaging another owned session. ' +
      'Use ReadTaskOutput with session_id for logs (including exited tasks).',
    schema: {
      session_id: z
        .number()
        .int()
        .optional()
        .describe('Session id (default: current session when running in a repo session)'),
    },
    handler: async ({ session_id }) => {
      let targetSessionId = callerSession?.id ?? null;
      if (session_id != null) {
        const { session, error } = await requireOwnedSessionById(app, session_id, userId);
        if (error) return fail(error);
        targetSessionId = session.id;
      }
      if (targetSessionId == null) {
        return fail('Provide session_id');
      }
      const tasksService = app.service('tasks');
      if (!tasksService?.filterTasks) {
        return fail('Task service unavailable');
      }
      const tasks = tasksService
        .filterTasks({
          sessionIds: new Set([targetSessionId]),
        })
        .filter((t) => isTaskActive(t.status));
      return ok({
        session_id: targetSessionId,
        tasks: tasks.map((t) => ({
          id: t.id,
          task_key: t.task_key,
          label: t.label,
          status: t.status,
          ports: t.ports,
        })),
      });
    },
  };
}
