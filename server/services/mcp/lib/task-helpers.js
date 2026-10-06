export function collectLastFailedTasks(tasksService, sessionId, { limit = 5 } = {}) {
  const cap = Math.min(Math.max(limit, 1), 20);
  return tasksService
    .listTasksForSession(sessionId, { limit: 50 })
    .filter((t) => t.status === 'exited' && t.exit_code != null && t.exit_code !== 0)
    .slice(0, cap)
    .map((t) => ({
      task_key: t.task_key,
      exit_code: t.exit_code,
      task_id: t.id,
      ended_at: t.exited_at,
    }));
}
