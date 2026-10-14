import { z } from 'zod';
import { isGlobalSession } from '../../../../shared/session-scope.js';
import { loadBaguetteConfig, getAvailableTasks } from '../../baguette-config.js';
import { ok, fail } from '../lib/result.js';
import { streamToLines } from '../lib/stream-to-lines.js';

export function createRunTaskTool(ctx) {
  const { app, session } = ctx;
  return {
    name: 'RunTask',
    description:
      'Run a command defined in this repo’s `.baguette.yaml` by label (from ListProjectCommands). Use the built-in Bash/shell tool for ad-hoc shell — not this MCP tool. Runs in the session worktree with session env and shows in the command panel. Tasks listed in the target task’s `depends-on` are started automatically and awaited until ready when you run that label — do not RunTask those dependencies separately. Baguette stops dependency-only tasks automatically when no task has been using them for more than 15 minutes. Default (detach: false): wait for exit and return exitCode/stdoutLines/stderrLines inline. detach: true for long-running work (dev servers, slow builds): returns taskId; poll ReadTaskOutput/TaskStatus, await completion with AwaitDetachedTask, stop with KillTask. Before ending your turn, usually AwaitDetachedTask or KillTask any detached tasks you started (except dev servers you intend to keep).',
    schema: {
      label: z.string().describe('Task key exactly as returned by ListProjectCommands'),
      args: z
        .array(z.string())
        .optional()
        .describe('Extra arguments appended to the command (file path, test pattern, flags, etc.)'),
      env: z
        .record(z.string())
        .optional()
        .describe('Extra environment variables merged on top of session env'),
      detach: z
        .boolean()
        .optional()
        .describe(
          'If true, run as a detached baguette task and return taskId immediately (use ReadTaskOutput/TaskStatus or AwaitDetachedTask). Default false: wait for exit and return output inline.'
        ),
    },
    handler: async ({ label, args = [], env: extraEnv, detach = false }) => {
      if (isGlobalSession(session)) {
        return fail('RunTask requires a repo session with a .baguette.yaml worktree');
      }
      let tasks;
      try {
        const cfg = await loadBaguetteConfig(session.session_path);
        if (cfg?.error) throw new Error(cfg.error);
        tasks = cfg ? getAvailableTasks(cfg) : null;
      } catch (err) {
        return fail(err.message);
      }

      if (!tasks) return fail('Baguette config not found');
      if (!tasks[label]) return fail(`Unknown command label: ${label}`);

      const createData = {
        session_id: session.id,
        task_key: label,
        args,
        extra_env: extraEnv,
      };

      if (detach) {
        try {
          const task = await app
            .service('tasks')
            .create(createData, { user: { id: session.user_id } });
          return ok({ taskId: task.id, label: task.label, status: task.status });
        } catch (err) {
          return fail(err.message);
        }
      }

      let stdout = '';
      let stderr = '';

      return new Promise((resolve) => {
        app
          .service('tasks')
          .create(
            {
              ...createData,
              onLog: (id, stream, data) => {
                if (stream === 'stdout') stdout += data;
                else stderr += data;
              },
              onExit: (id, exitCode) =>
                resolve(
                  ok({
                    exitCode,
                    stdoutLines: streamToLines(stdout),
                    stderrLines: streamToLines(stderr),
                  })
                ),
            },
            { user: { id: session.user_id } }
          )
          .catch((err) => resolve(fail(err.message)));
      });
    },
  };
}
