import { isTaskActive } from '../../../shared/task-status.js';

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function asFiniteId(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve which baguette task a RunTask / AwaitDetachedTask MCP call refers to.
 * @param {'RunTask' | 'AwaitDetachedTask'} toolName
 * @param {Record<string, unknown> | undefined} args
 * @param {Record<string, unknown> | null | undefined} parsedResult
 */
export function resolveTaskTargetFromMcpTool(toolName, args, parsedResult) {
  const data =
    parsedResult && typeof parsedResult === 'object' && !Array.isArray(parsedResult)
      ? parsedResult
      : null;

  let taskId = asFiniteId(data?.taskId ?? data?.task_id);
  let label =
    (typeof data?.label === 'string' && data.label.trim() ? data.label.trim() : null) ??
    (typeof args?.label === 'string' && args.label.trim() ? args.label.trim() : null);

  if (toolName === 'AwaitDetachedTask' && taskId == null) {
    taskId = asFiniteId(args?.taskId ?? args?.task_id);
  }

  return { taskId, label };
}

/**
 * @param {Array<{ id?: number; label?: string | null; task_key?: string | null; status?: string }> | undefined} tasks
 * @param {number} taskId
 */
export function findSessionTaskById(tasks, taskId) {
  if (!Array.isArray(tasks) || taskId == null || !Number.isFinite(taskId)) return null;
  return tasks.find((task) => task.id === taskId) ?? null;
}

/** Config-backed tasks match on `task_key`; ad-hoc tasks (no task_key) match on `label`. */
function taskMatchesLookupKey(task, key) {
  if (task.task_key) return task.task_key === key;
  return task.label === key;
}

function pickNewestTaskById(candidates) {
  if (!candidates.length) return null;
  return candidates.reduce((best, task) => {
    const bestId = best?.id ?? -1;
    const nextId = task?.id ?? -1;
    return nextId > bestId ? task : best;
  });
}

/**
 * Newest matching RunTask by config task_key (or ad-hoc label) — used while the MCP call is still running.
 * @param {Array<{ id?: number; label?: string | null; task_key?: string | null; status?: string }> | undefined} tasks
 * @param {string} label
 */
export function findRunningTaskByLabel(tasks, label) {
  const trimmed = typeof label === 'string' ? label.trim() : '';
  if (!trimmed || !Array.isArray(tasks) || !tasks.length) return null;
  const matches = tasks.filter((task) => taskMatchesLookupKey(task, trimmed));
  const running = matches.filter((task) => isTaskActive(task.status));
  return pickNewestTaskById(running) ?? pickNewestTaskById(matches);
}

/**
 * Session task to open from this MCP tool call, if known.
 * @param {Array<{ id?: number; label?: string | null; task_key?: string | null; status?: string }> | undefined} tasks
 * @param {'RunTask' | 'AwaitDetachedTask'} toolName
 * @param {Record<string, unknown> | undefined} args
 * @param {Record<string, unknown> | null | undefined} parsedResult
 * @param {{ isRunning?: boolean }} [options]
 */
export function resolveOpenTaskFromMcpTool(tasks, toolName, args, parsedResult, options = {}) {
  const { isRunning = false } = options;
  const target = resolveTaskTargetFromMcpTool(toolName, args, parsedResult);

  if (target.taskId != null) {
    const fromSession = findSessionTaskById(tasks, target.taskId);
    if (fromSession) return fromSession;
    return {
      id: target.taskId,
      label: target.label,
    };
  }

  if (toolName === 'RunTask' && isRunning && typeof args?.label === 'string') {
    return findRunningTaskByLabel(tasks, args.label);
  }

  return null;
}
