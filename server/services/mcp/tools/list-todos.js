export function createListTodosTool(h) {
  return {
    name: 'ListTodos',
    description:
      'List session todos that are open (pending or in progress). Use before ProcessTodo or CompleteTodo when you need ids.',
    schema: {},
    handler: h.listTodos,
  };
}
