import { sameScopeId } from '../utils/boundScope.js';

/**
 * Does a task event belong in a tasks-list cache entry filtered by `filter`
 * (`{ sessionId, status }`, either side optional)?
 */
function taskEventMatchesFilter(filter, task) {
  if (!task?.id) return false;
  if (filter?.sessionId != null && !sameScopeId(filter.sessionId, task.session_id)) return false;
  if (filter?.status != null && task.status !== filter.status) return false;
  return true;
}

/**
 * Apply a tasks service event to a cached rows array (created/patched/removed
 * semantics of the previous per-hook listeners). Returns the same reference
 * when nothing changed.
 *
 * @param {object[]} rows
 * @param {object} task
 * @param {'created'|'patched'|'removed'} event
 */
function applyTaskEventToRows(rows, task, event) {
  if (!Array.isArray(rows) || !task?.id) return rows;
  const exists = rows.some((t) => t.id === task.id);
  if (event === 'created') {
    if (exists) return rows;
    return [task, ...rows];
  }
  if (event === 'removed') {
    if (!exists) return rows;
    return rows.filter((t) => t.id !== task.id);
  }
  if (!exists) return rows;
  return rows.map((t) => (t.id === task.id ? { ...t, ...task } : t));
}

/**
 * Apply an event to a filtered tasks-list entry. A patched task that no longer
 * matches the entry's filter (e.g. its status changed) is dropped instead of
 * merged, matching the previous per-hook behavior.
 */
export function applyTaskEventToFilteredRows(rows, task, event, filter) {
  if (taskEventMatchesFilter(filter, task)) return applyTaskEventToRows(rows, task, event);
  if (event === 'patched') return applyTaskEventToRows(rows, task, 'removed');
  return rows;
}
