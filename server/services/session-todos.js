const TODO_STATUSES = ['pending', 'in_progress', 'completed'];

/** Pending and in_progress — open work (e.g. `todos` on CreateTodo/UpdateTodo/DeleteTodo responses). */
export const OPEN_TODO_STATUSES = ['pending', 'in_progress'];

export function assertTodoStatus(status) {
  if (!TODO_STATUSES.includes(status)) {
    throw new Error(`status must be one of: ${TODO_STATUSES.join(', ')}`);
  }
}

export function serializeTodo(row) {
  return {
    id: row.id,
    ref: row.ref,
    session_id: row.session_id,
    title: row.title ?? null,
    content: row.content,
    status: row.status,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
