export const AGENT_SDK_IDS = ['claude', 'cursor'];

/** Account- or repo-level credential is configured (masked/plain key fields are truthy when set). */
export function hasAgentSdkCredential(sdk, userSettings, repo) {
  if (sdk === 'cursor') {
    return Boolean(userSettings?.cursor_api_key || repo?.cursor_api_key);
  }
  return Boolean(
    userSettings?.anthropic_api_key ||
    userSettings?.anthropic_auth_token ||
    repo?.anthropic_api_key ||
    repo?.anthropic_auth_token
  );
}

export function availableAgentSdks(userSettings, repo) {
  return AGENT_SDK_IDS.filter((sdk) => hasAgentSdkCredential(sdk, userSettings, repo));
}

export function agentSdkCredentialTooltip(sdk) {
  const label = sdk === 'cursor' ? 'Cursor' : 'Claude';
  return `${label} API key not configured`;
}

/** Effective API keys for model listing (repo overrides account when set). */
export function resolveAgentSdkKeys(user, repo) {
  return {
    anthropic_api_key: repo?.anthropic_api_key || user?.anthropic_api_key || null,
    anthropic_auth_token: repo?.anthropic_auth_token || user?.anthropic_auth_token || null,
    cursor_api_key: repo?.cursor_api_key || user?.cursor_api_key || null,
  };
}
