import { z } from 'zod';
import { isPortListening } from '../../port-utils.js';
import { ok, fail } from '../lib/result.js';

export function createTaskStatusTool(ctx) {
  const { app, session } = ctx;
  return {
    name: 'TaskStatus',
    description:
      'Get the status of a baguette task by its ID, including whether each assigned port is currently listening. Useful for checking if a dev server is ready after starting it with RunTask (detach: true).',
    schema: {
      taskId: z.number().int().describe('Task ID from RunTask or ListRunningTasks'),
    },
    handler: async ({ taskId }) => {
      const task = app.service('tasks').getTask(taskId);
      if (!task) return fail(`Task ${taskId} not found`);
      if (task.session_id !== session.id)
        return fail(`Task ${taskId} does not belong to this session`);
      const portEntries = Object.entries(task.ports);
      const portStatus = {};
      await Promise.all(
        portEntries.map(async ([envVar, port]) => {
          portStatus[envVar] = { port, listening: await isPortListening(port) };
        })
      );
      return ok({
        taskId: task.id,
        label: task.label,
        status: task.status,
        exit_code: task.exit_code,
        ports: portStatus,
      });
    },
  };
}
