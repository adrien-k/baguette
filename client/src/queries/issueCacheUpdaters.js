import { sortIssuesBySeverity } from '@baguette/shared/session-issues.js';

/**
 * Apply a sessionIssues service event to a cached rows array, matching the
 * previous per-hook semantics: created rows are dedupe-added, patches of
 * closed rows drop the entry, removals drop it; result re-sorted by severity.
 *
 * @param {object[]} rows
 * @param {object} issue
 * @param {'created'|'patched'|'removed'} event
 */
export function applyIssueEventToRows(rows, issue, event) {
  if (!Array.isArray(rows) || !issue?.id) return rows;
  const exists = rows.some((i) => i.id === issue.id);
  if (event === 'created') {
    if (exists) return rows;
    return sortIssuesBySeverity([...rows, issue]);
  }
  if (event === 'removed') {
    if (!exists) return rows;
    return rows.filter((i) => i.id !== issue.id);
  }
  if (!exists) return rows;
  if (issue.status === 'closed') {
    return rows.filter((i) => i.id !== issue.id);
  }
  return sortIssuesBySeverity(rows.map((i) => (i.id === issue.id ? issue : i)));
}
