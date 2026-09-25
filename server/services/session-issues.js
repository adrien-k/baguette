export const ISSUE_STATUSES = ['opened', 'submitted', 'ignored', 'resolved'];
export const ISSUE_SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const AGENT_ISSUE_STATUSES = ['ignored', 'resolved'];

export function assertIssueStatus(status) {
  if (!ISSUE_STATUSES.includes(status)) {
    throw new Error(`Invalid issue status "${status}". Use: ${ISSUE_STATUSES.join(', ')}`);
  }
}

export function assertAgentIssueStatus(status) {
  if (!AGENT_ISSUE_STATUSES.includes(status)) {
    throw new Error(`Invalid status "${status}". Use: ${AGENT_ISSUE_STATUSES.join(', ')}`);
  }
}

export function assertIssueSeverity(severity) {
  if (!ISSUE_SEVERITIES.includes(severity)) {
    throw new Error(`Invalid severity "${severity}". Use: ${ISSUE_SEVERITIES.join(', ')}`);
  }
}

export function serializeIssue(row) {
  if (!row) return null;
  return {
    id: row.id,
    session_id: row.session_id,
    severity: row.severity,
    title: row.title,
    description: row.description ?? '',
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
