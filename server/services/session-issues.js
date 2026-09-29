export const ISSUE_STATUSES = ['opened', 'submitted', 'ignored', 'resolved', 'closed'];
/** Statuses the reviewer may set via UpdateIssue (use CloseIssue to archive). */
export const REVIEWER_UPDATE_STATUSES = ['opened', 'submitted', 'ignored', 'resolved'];
export const ISSUE_SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const AGENT_ISSUE_STATUSES = ['ignored', 'resolved'];

export function isIssueClosed(issue) {
  return issue?.status === 'closed';
}

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

/** Snapshot from the review turn MCP tool closure (not the session row). */
export function issueAgentMetadataFromTurn(turnAgent = {}) {
  const agent_sdk = turnAgent.agent_sdk ?? null;
  return {
    agent_sdk,
    model: turnAgent.model ?? null,
    model_params: agent_sdk === 'cursor' ? (turnAgent.model_params ?? null) : null,
  };
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
    agent_sdk: row.agent_sdk ?? null,
    model: row.model ?? null,
    model_params: row.model_params ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
