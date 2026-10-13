import { z } from 'zod';
import { createTodoHandlers } from '../lib/todo-handlers.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';

const todoRefSchema = z.coerce
  .number()
  .int()
  .min(1)
  .describe('Todo ref (session-relative number from ListTodos)');

export function createCompleteTodoTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'CompleteTodo',
    description:
      'Complete a session todo by ref (marks it completed; it stays visible on the Plan tab). session_id is required. Returns the completed todo and remaining open todos.',
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
      return createTodoHandlers(session, app).completeTodo(args);
    },
  };
}
