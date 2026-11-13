import { z } from 'zod';
import { mcpAwaitTimeoutMinutes } from '../../../../shared/mcp-await-timeout.js';
import { fail } from '../lib/result.js';
import { waitForTaskLines } from '../lib/wait-for-task-lines.js';

export function createAwaitDetachedTaskTool(ctx) {
  const { app, session } = ctx;
  const waitMinutes = mcpAwaitTimeoutMinutes();
  return {
    name: 'AwaitDetachedTask',
    description:
      `Block until a detached baguette task (from RunTask with detach: true) exits (up to ${waitMinutes} minutes per call), then return exitCode/stdoutLines/stderrLines like an inline RunTask. ` +
      'On timeout the task is NOT cancelled — the wait is virtually detached and the task keeps running: use ReadTaskOutput or TaskStatus to check progress, then AwaitDetachedTask again to continue waiting, or KillTask only if it looks stuck for no good reason. ' +
      'Prefer calling this before ending your turn when a detached build or command must finish.',
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
