/** @param {string} name */
export function normalizeAgentFixedPushBranchName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || null;
}

/**
 * @param {string[] | string | null | undefined | { agent_fixed_push_branches?: unknown }} source
 * @returns {string[]}
 */
export function parseAgentFixedPushBranches(source) {
  if (source == null) return [];
  let raw = source;
  if (typeof source === 'object' && !Array.isArray(source)) {
    raw = source.agent_fixed_push_branches;
  }
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((name) => normalizeAgentFixedPushBranchName(name)).filter(Boolean))];
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return [
          ...new Set(parsed.map((name) => normalizeAgentFixedPushBranchName(name)).filter(Boolean)),
        ];
      }
    } catch {
      return [
        ...new Set(
          raw
            .split(/[,\n]/)
            .map((name) => normalizeAgentFixedPushBranchName(name))
            .filter(Boolean)
        ),
      ];
    }
  }
  return [];
}

/**
 * @param {string | null | undefined} branchName
 * @param {string[]} fixedBranches
 */
export function isAgentFixedPushTarget(branchName, fixedBranches) {
  const branch = normalizeAgentFixedPushBranchName(branchName);
  if (!branch || !fixedBranches?.length) return false;
  return fixedBranches.includes(branch);
}
