/** Highest severity first (critical → low). */
export const ISSUE_SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

const SEVERITY_RANK = Object.fromEntries(ISSUE_SEVERITY_ORDER.map((s, i) => [s, i]));

/** @param {{ severity?: string, status?: string, id?: number }} a @param {{ severity?: string, status?: string, id?: number }} b */
export function compareIssuesBySeverity(a, b) {
  const aIgnored = a.status === 'ignored' ? 1 : 0;
  const bIgnored = b.status === 'ignored' ? 1 : 0;
  if (aIgnored !== bIgnored) return aIgnored - bIgnored;

  const ra = SEVERITY_RANK[a.severity] ?? 99;
  const rb = SEVERITY_RANK[b.severity] ?? 99;
  if (ra !== rb) return ra - rb;
  return (a.id ?? 0) - (b.id ?? 0);
}

export function sortIssuesBySeverity(issues) {
  return [...issues].sort(compareIssuesBySeverity);
}
