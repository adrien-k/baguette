/** Highest severity first (critical → low). */
export const ISSUE_SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

export const ISSUE_SEVERITIES = ISSUE_SEVERITY_ORDER;

const SEVERITY_RANK = Object.fromEntries(ISSUE_SEVERITY_ORDER.map((s, i) => [s, i]));

/** Non-ignored: opened on top, then submitted, then resolved. Ignored sorts last. */
const STATUS_RANK = { opened: 0, submitted: 1, resolved: 2, ignored: 3 };

/** @param {{ severity?: string, status?: string, id?: number, ref?: number }} a @param {{ severity?: string, status?: string, id?: number, ref?: number }} b */
export function compareIssuesBySeverity(a, b) {
  const aIgnored = a.status === 'ignored' ? 1 : 0;
  const bIgnored = b.status === 'ignored' ? 1 : 0;
  if (aIgnored !== bIgnored) return aIgnored - bIgnored;

  const sa = STATUS_RANK[a.status] ?? 99;
  const sb = STATUS_RANK[b.status] ?? 99;
  if (sa !== sb) return sa - sb;

  const ra = SEVERITY_RANK[a.severity] ?? 99;
  const rb = SEVERITY_RANK[b.severity] ?? 99;
  if (ra !== rb) return ra - rb;

  return (a.ref ?? 0) - (b.ref ?? 0);
}

export function sortIssuesBySeverity(issues) {
  return [...issues].sort(compareIssuesBySeverity);
}

/** User message text when asking the builder to fix a single review issue (body comes from ReadIssue). */
export function issueFixAgentPrompt(issue, sessionId) {
  return (
    `Fix session review issue #${issue.ref}.\n\n` +
    `Call ReadIssue with ref ${issue.ref} and session_id ${sessionId} for details. ` +
    `This issue is now submitted. When the fix is complete, call UpdateIssueStatus with ref ${issue.ref}, session_id ${sessionId}, and status "resolved".`
  );
}

/** User message text when asking the builder to fix all opened review issues on a session. */
export function issuesFixAllAgentPrompt(sessionId) {
  return (
    `Fix all submitted session review issues on this session.\n\n` +
    `Start by calling ListIssues with status "submitted" (session_id ${sessionId}). ` +
    `For each issue: call ReadIssue for details, implement the fix, then call UpdateIssueStatus with status "resolved" before moving on to the next issue. ` +
    `Prefer one separate git commit per issue; combine multiple issues into a single commit only when they can be fixed together easily in one change.`
  );
}
