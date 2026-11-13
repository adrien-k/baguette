import { z } from 'zod';
import { createTodoHandlers } from '../lib/todo-handlers.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';

export function createListTodosTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'ListTodos',
    description:
      "List session todos (pending, in_progress, and completed), including `plan_id`. session_id is required. When this agent is on an open plan, returns that plan's todos (including completed). Prefer the pending and in_progress items when deciding what to work on next. Use ref from the list with UpdateTodo (mark completed when done).",
    schema: {
      session_id: z.number().int().describe('Session id'),
    },
    handler: async (args) => {
      const { session, result: sessionError } = await requireMcpSession(
        app,
        args.session_id,
        userId
      );
      if (sessionError) return sessionError;
      return createTodoHandlers(session, app, { callerAgent: ctx.callerAgent }).listTodos();
    },
  };
}
