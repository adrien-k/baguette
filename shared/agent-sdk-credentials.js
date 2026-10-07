/** Effective API keys for model listing (repo overrides account when set). */
export function resolveAgentSdkKeys(user, repo) {
  return {
    anthropic_api_key: repo?.anthropic_api_key || user?.anthropic_api_key || null,
    anthropic_auth_token: repo?.anthropic_auth_token || user?.anthropic_auth_token || null,
    cursor_api_key: repo?.cursor_api_key || user?.cursor_api_key || null,
    pi_api_key: repo?.pi_api_key || user?.pi_api_key || null,
    pi_api_key_env_var: repo?.pi_api_key_env_var ?? user?.pi_api_key_env_var ?? null,
  };
}
