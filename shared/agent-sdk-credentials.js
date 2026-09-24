/** Account- or repo-level credential is configured (masked/plain key fields are truthy when set). */
export function hasAgentSdkCredential(sdk, userSettings, repo) {
  if (sdk === 'cursor') {
    return Boolean(userSettings?.cursor_api_key || repo?.cursor_api_key);
  }
  return Boolean(userSettings?.anthropic_api_key || repo?.anthropic_api_key);
}

export function availableAgentSdks(userSettings, repo) {
  const sdks = [];
  if (hasAgentSdkCredential('claude', userSettings, repo)) sdks.push('claude');
  if (hasAgentSdkCredential('cursor', userSettings, repo)) sdks.push('cursor');
  return sdks;
}

/** Effective API keys for model listing (repo overrides account when set). */
export function resolveAgentSdkKeys(user, repo) {
  return {
    anthropic_api_key: repo?.anthropic_api_key || user?.anthropic_api_key || null,
    cursor_api_key: repo?.cursor_api_key || user?.cursor_api_key || null,
  };
}
