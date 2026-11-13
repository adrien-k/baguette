import { z } from 'zod';
import {
  DEFAULT_LOG_BYTES,
  MAX_LOG_RANGE_BYTES,
  sliceByteRange,
  validateLogByteRange,
} from '../../mcp-pagination.js';
import { ok, fail } from '../lib/result.js';
import { resolveOwnedSession } from '../lib/session-resolution.js';

export function createReadTaskOutputTool(ctx) {
  const { app, session } = ctx;
  return {
    name: 'ReadTaskOutput',
    description:
      `Read the log output of a running or exited baguette task. Defaults to the last ${DEFAULT_LOG_BYTES} bytes. ` +
      `When endByte is omitted, returns max(${MAX_LOG_RANGE_BYTES}, bytes from startByte through EOF). When both startByte and endByte are set, ` +
      `the range is capped at ${MAX_LOG_RANGE_BYTES} bytes. Negative indices count from the end; do not combine a negative ` +
      'startByte with a non-negative endByte. Omit session_id for the current session; pass session_id to read logs from ' +
      'another owned session (e.g. from a global triage session). Use ListRunningTasks to discover running task ids.',
    schema: {
      session_id: z
        .number()
        .int()
        .optional()
        .describe('Target session id (default: current session)'),
      taskId: z.number().int().optional().describe('Task ID from ListRunningTasks'),
      task_key: z
        .string()
        .optional()
        .describe('Task key — latest run in the target session when taskId is omitted'),
      startByte: z
        .number()
        .optional()
        .describe(
          `Start byte (0-based). Negative values count from the end. Omit both bounds for the last ${DEFAULT_LOG_BYTES} bytes.`
        ),
      endByte: z
        .number()
        .optional()
        .describe(
          `Inclusive end byte (optional). Negative values count from the end. When omitted, end is startByte + max(${MAX_LOG_RANGE_BYTES}, bytes remaining until EOF). Must be negative if startByte is negative.`
        ),
    },
    handler: async ({ session_id, taskId, task_key, startByte, endByte }) => {
      const validationError = validateLogByteRange({ startByte, endByte });
      if (validationError) return fail(validationError);
      if (taskId == null && !task_key?.trim()) {
        return fail('Provide taskId or task_key');
      }

      let targetSessionId = session.id;
      if (session_id != null) {
        const owned = await resolveOwnedSession(app, { session_id }, session.user_id);
        if (!owned) return fail('Session not found');
        targetSessionId = owned.id;
      }

      const tasksService = app.service('tasks');
      let task = null;
      if (taskId != null) {
        task = tasksService.getTask(taskId);
        if (task && task.session_id !== targetSessionId) task = null;
      } else {
        task = tasksService.findLatestTaskByTaskKey?.(targetSessionId, task_key) ?? null;
      }
      if (!task) return fail('Task not found');

      try {
        const {
          log,
          totalBytes,
          startByte: actualStart,
          endByte: actualEnd,
        } = sliceByteRange(task.getLogs(), { startByte, endByte });
        return ok({
          session_id: targetSessionId,
          taskId: task.id,
          task_key: task.task_key,
          totalBytes,
          startByte: actualStart,
          endByte: actualEnd,
          log,
        });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
