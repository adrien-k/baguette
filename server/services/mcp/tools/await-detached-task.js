import { z } from 'zod';
import { fail } from '../lib/result.js';
import { waitForTaskLines } from '../lib/wait-for-task-lines.js';

export function createAwaitDetachedTaskTool(ctx) {
  const { app, session } = ctx;
  return {
    name: 'AwaitDetachedTask',
    description:
      'Block until a detached baguette task (from RunTask with detach: true) exits, then return exitCode/stdoutLines/stderrLines like an inline RunTask. Use when you started a task detached and need its final output without polling ReadTaskOutput. Prefer calling this before ending your turn when a detached build or command must finish.',
    schema: {
      taskId: z.number().int().describe('Task ID from RunTask (detach: true) or ListRunningTasks'),
    },
    handler: async ({ taskId }) => {
      const task = app.service('tasks').getTask(taskId);
      if (!task) return fail(`Task ${taskId} not found`);
      if (task.session_id !== session.id)
        return fail(`Task ${taskId} does not belong to this session`);
      return waitForTaskLines(task);
    },
  };
}
