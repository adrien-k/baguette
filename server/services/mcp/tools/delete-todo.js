import { z } from 'zod';
import { createTodoHandlers } from '../lib/todo-handlers.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';
import { todoRefSchema } from '../lib/todo-ref-schema.js';

export function createDeleteTodoTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'DeleteTodo',
    description:
      "Permanently delete one or more session todos by ref (#N on the Plan tab; the `ref` field from todo objects, not the database `id`). session_id is required. Use to remove todos that are no longer relevant to the user's goal (scope change, superseded work, explicit user request). Sessions can have multiple agents—do not delete a todo just because it is missing from your turn context or was created by another agent; prefer UpdateTodo to adjust open work you own. Returns deleted todos and remaining open todos.",
    schema: {
      session_id: z.number().int().describe('Session id'),
      refs: z.array(todoRefSchema).min(1).describe('One or more todo refs to delete'),
    },
    handler: async (args) => {
      const { session, result: sessionError } = await requireMcpSession(
        app,
        args.session_id,
        userId
      );
      if (sessionError) return sessionError;
      return createTodoHandlers(session, app).deleteTodos(args);
    },
  };
}
