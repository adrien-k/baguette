import { z } from 'zod';
export function createCreateTodoTool(h) {
  return {
    name: 'CreateTodo',
    description:
      'Add a session todo. Pass a short `title` and markdown `content` for the concrete work. Todos execute in the same session cwd and system prompt—do not restate paths or system instructions in `content`. New todos start as pending. Prefer this over SDK TodoWrite.',
    schema: {
      title: z
        .string()
        .describe('Short label for the todo (shown in lists and the composer todo card).'),
      content: z
        .string()
        .describe(
          'What to do (markdown). Concrete task only—no cwd, working_directory, or system-prompt boilerplate.'
        ),
    },
    handler: h.createTodo,
  };
}
