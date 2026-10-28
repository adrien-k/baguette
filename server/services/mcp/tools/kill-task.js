import { z } from 'zod';
import { ok, fail } from '../lib/result.js';

export function createKillTaskTool(ctx) {
  const { app, session } = ctx;
  return {
    name: 'KillTask',
    description:
      'Kill a running baguette task by its ID. Use when a detached task is stuck or after AwaitDetachedTask times out with no progress (ReadTaskOutput first). Also use before ending your turn to stop detached tasks you no longer need.',
    schema: { taskId: z.number().int().describe('Task ID from ListRunningTasks') },
    handler: async ({ taskId }) => {
      const task = app.service('tasks').getTask(taskId);
      if (!task) return fail(`Task ${taskId} not found`);
      if (task.session_id !== session.id)
        return fail(`Task ${taskId} does not belong to this session`);
      const killed = await task.kill();
      return ok({ killed, taskId });
    },
  };
}
