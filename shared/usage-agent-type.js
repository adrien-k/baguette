/** Normalize usage / filter values to `builder` | `reviewer` | `subagent`. */
export function normalizeUsageAgentType(value) {
  if (value === 'reviewer' || value === 'review') return 'reviewer';
  if (value === 'subagent') return 'subagent';
  return 'builder';
}

/**
 * Parse breakdown filter from API query (`agent_type` or legacy `kind`).
 * @returns {'builder'|'reviewer'|'subagent'|null}
 */
export function parseUsageAgentTypeFilter(query = {}) {
  const raw = query.agent_type ?? query.kind;
  if (!raw) return null;
  if (raw === 'review' || raw === 'reviewer') return 'reviewer';
  if (raw === 'subagent') return 'subagent';
  if (raw === 'session' || raw === 'chat' || raw === 'builder') return 'builder';
  return null;
}
