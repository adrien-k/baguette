import { z } from 'zod';
import { createTodoHandlers } from '../lib/todo-handlers.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';

export function createListTodosTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'ListTodos',
    description:
      'List all session todos (pending, in_progress, and completed). session_id is required. Prefer the pending and in_progress items when deciding what to work on next. Use ref from the list with UpdateTodo or DeleteTodo.',
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
      return createTodoHandlers(session, app).listTodos();
    },
  };
}
