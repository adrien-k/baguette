const MAX_LABEL_LEN = 20;

export function truncateLabel(label, maxLen = MAX_LABEL_LEN) {
  const s = String(label ?? '').trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}

export function sdkDisplayName(sdk) {
  if (sdk === 'cursor') return 'Cursor';
  if (sdk === 'pi') return 'Pi';
  if (sdk === 'mock') return 'Mock';
  return 'Claude';
}

/** Account-level config label for an SDK. */
export function accountAgentConfigLabel(sdk) {
  return truncateLabel(sdkDisplayName(sdk));
}

/** Per-repo config label: "{Sdk} {repoShort}" truncated to 20 chars. */
export function repoAgentConfigLabel(sdk, repoFullName) {
  const short = repoShortName(repoFullName);
  return truncateLabel(`${sdkDisplayName(sdk)} ${short}`);
}

function repoShortName(repoFullName) {
  return repoFullName?.includes('/') ? repoFullName.split('/').pop() : repoFullName || 'repo';
}

/**
 * Per-repo Claude auth-token config label: "Claude token {repoShort}" truncated to 20 chars.
 * Always longer than the bare CLAUDE_TOKEN_LABEL, so account-scope lookups by the bare label
 * can never match a repo-scoped token config.
 */
export function repoAgentTokenLabel(repoFullName) {
  return truncateLabel(`${sdkDisplayName('claude')} token ${repoShortName(repoFullName)}`);
}

export const CLAUDE_TOKEN_LABEL = truncateLabel('Claude token');

/**
 * Pick a unique label for a user by suffixing -2, -3, … when needed.
 * @param {Set<string>} usedLower — existing labels for the user (lowercase)
 */
export function uniqueAgentConfigLabel(baseLabel, usedLower) {
  let candidate = truncateLabel(baseLabel);
  if (!usedLower.has(candidate.toLowerCase())) return candidate;
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const trimmed = truncateLabel(baseLabel, MAX_LABEL_LEN - suffix.length);
    candidate = `${trimmed}${suffix}`;
    if (!usedLower.has(candidate.toLowerCase())) return candidate;
  }
  return `${truncateLabel(baseLabel, 16)}-99`;
}
