import { getSdkPlugin } from '../agent-sdks/registry.js';

export const ISSUE_STATUSES = [
  'needs_decision',
  'opened',
  'submitted',
  'ignored',
  'resolved',
  'closed',
];
/** Statuses the reviewer may set via UpdateIssue (use CloseIssue to archive). */
export const REVIEWER_UPDATE_STATUSES = [
  'needs_decision',
  'opened',
  'submitted',
  'ignored',
  'resolved',
];
export const ISSUE_SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const AGENT_ISSUE_STATUSES = ['ignored', 'resolved'];

const OPTIONS_RANGE = 'options must contain 2 to 5 items';

function optionText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

/**
 * Validate decision options. `null` leaves them unset. An empty array clears
 * them. A non-empty list must be 2–5 items with unique non-empty id and title.
 * @returns {null | Array<{ id: string, title: string, description?: string }>}
 */
function normalizeIssueOptions(options) {
  if (options == null) return null;
  if (!Array.isArray(options)) throw new Error('options must be an array');
  if (options.length === 0) return [];
  if (options.length < 2 || options.length > 5) throw new Error(OPTIONS_RANGE);

  const seen = new Set();
  const normalized = [];
  for (const item of options) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('each option needs a non-empty id and title');
    }
    const id = optionText(item.id);
    const title = optionText(item.title);
    if (!id || !title) throw new Error('each option needs a non-empty id and title');
    if (seen.has(id)) throw new Error(`duplicate option id "${id}"`);
    seen.add(id);
    const entry = { id, title };
    const description = item.description == null ? '' : optionText(String(item.description));
    if (description) entry.description = description;
    normalized.push(entry);
  }
  return normalized;
}

/** JSON text for the `options` column, or null when unset or cleared. */
export function serializeIssueOptions(options) {
  const normalized = normalizeIssueOptions(options);
  if (!normalized || normalized.length === 0) return null;
  return JSON.stringify(normalized);
}

/** Parse stored options. Accepts the JSON column or an already-parsed array. */
export function parseStoredOptions(value) {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True when options exist and the user has not chosen yet. */
export function issueAwaitingDecision(issue) {
  const options = parseStoredOptions(issue?.options);
  if (!options?.length) return false;
  return !issue?.selected_option_id;
}

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
  const supportsParams = getSdkPlugin(agent_sdk)?.supportsModelParams === true;
  return {
    agent_sdk,
    model: turnAgent.model ?? null,
    model_params: supportsParams ? (turnAgent.model_params ?? null) : null,
  };
}

export function serializeIssue(row) {
  if (!row) return null;
  return {
    id: row.id,
    ref: row.ref,
    session_id: row.session_id,
    severity: row.severity,
    title: row.title,
    description: row.description ?? '',
    status: row.status,
    agent_sdk: row.agent_sdk ?? null,
    model: row.model ?? null,
    model_params: row.model_params ?? null,
    options: parseStoredOptions(row.options),
    selected_option_id: row.selected_option_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
