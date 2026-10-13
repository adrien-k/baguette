/** Normalize usage / filter values to `builder` | `reviewer`. */
export function normalizeUsageAgentType(value) {
  if (value === 'reviewer' || value === 'review') return 'reviewer';
  return 'builder';
}

/**
 * Parse breakdown filter from API query (`agent_type` or legacy `kind`).
 * @returns {'builder'|'reviewer'|null}
 */
export function parseUsageAgentTypeFilter(query = {}) {
  const raw = query.agent_type ?? query.kind;
  if (!raw) return null;
  if (raw === 'review' || raw === 'reviewer') return 'reviewer';
  if (raw === 'session' || raw === 'chat' || raw === 'builder') return 'builder';
  return null;
}
