import { z } from 'zod';
import { createTodoHandlers } from '../lib/todo-handlers.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';

const todoRefSchema = z.coerce
  .number()
  .int()
  .min(1)
  .describe('Todo ref (session-relative number from ListTodos)');

export function createProcessTodoTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'ProcessTodo',
    description:
      'Mark a session todo as in progress by ref. session_id is required. Returns the updated todo and open todos.',
    schema: {
      session_id: z.number().int().describe('Session id'),
      ref: todoRefSchema,
    },
    handler: async (args) => {
      const { session, result: sessionError } = await requireMcpSession(
        app,
        args.session_id,
        userId
      );
      if (sessionError) return sessionError;
      return createTodoHandlers(session, app).processTodo(args);
    },
  };
}
