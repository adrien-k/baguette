import { z } from 'zod';

export function createProcessTodoTool(h) {
  return {
    name: 'ProcessTodo',
    description:
      'Mark a session todo as in progress by id. Returns the updated todo and open todos.',
    schema: {
      id: z.coerce.number().int().describe('Todo id'),
    },
    handler: h.processTodo,
  };
}
