import { z } from 'zod';
import { createTodoHandlers } from '../lib/todo-handlers.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';
import { todoRefSchema } from '../lib/todo-ref-schema.js';

const todoStatusSchema = z
  .enum(['pending', 'in_progress', 'completed'])
  .describe('Todo status (completed todos stay visible on the Plan tab)');

export function createUpdateTodoTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'UpdateTodo',
    description:
      'Update a session todo by ref: pass any combination of status (pending, in_progress, completed), title, and/or markdown content. At least one field is required. session_id is required. Use status in_progress when starting work and completed when done. Returns the updated todo and open todos.',
    schema: {
      session_id: z.number().int().describe('Session id'),
      ref: todoRefSchema,
      status: todoStatusSchema.optional(),
      title: z
        .string()
        .optional()
        .describe('Short label for the todo (shown in lists and the Plan tab).'),
      content: z
        .string()
        .optional()
        .describe('What to do (markdown). Concrete task only—no session boilerplate.'),
    },
    handler: async (args) => {
      const { session, result: sessionError } = await requireMcpSession(
        app,
        args.session_id,
        userId
      );
      if (sessionError) return sessionError;
      return createTodoHandlers(session, app).updateTodo(args);
    },
  };
}
