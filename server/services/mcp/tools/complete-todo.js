import { z } from 'zod';

export function createCompleteTodoTool(h) {
  return {
    name: 'CompleteTodo',
    description:
      'Complete a session todo by id (removes it from the open list). Returns the completed todo and remaining open todos.',
    schema: {
      id: z.coerce.number().int().describe('Todo id'),
    },
    handler: h.completeTodo,
  };
}
