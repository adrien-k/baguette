import { z } from 'zod';
import { createTodoHandlers } from '../lib/todo-handlers.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';

export function createListTodosTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'ListTodos',
    description:
      'List session todos that are open (pending or in progress). session_id is required. Use ref from the list with ProcessTodo or CompleteTodo.',
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
