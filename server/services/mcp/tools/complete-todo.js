import { z } from 'zod';

export function createCompleteTodoTool(h) {
  return {
    name: 'CompleteTodo',
    description:
      'Complete a session todo by id (marks it completed; it stays visible on the Plan tab). Returns the completed todo and remaining open todos.',
    schema: {
      id: z.coerce.number().int().describe('Todo id'),
    },
    handler: h.completeTodo,
  };
}
