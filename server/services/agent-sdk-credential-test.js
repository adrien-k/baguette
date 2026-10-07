import { buildClaudeTestEnv, runClaudeConnectivityTest } from './claude-connectivity.js';
import { runCursorConnectivityTest } from './cursor-connectivity.js';
import { resolvePiEffectiveForTest, runPiConnectivityTest } from './pi-connectivity.js';
import { normalizeAnthropicBaseUrl } from './session-env.js';

function pick(override, saved) {
  return override !== undefined ? override : saved;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} user — plaintext keys from internal users.get
 * @param {Record<string, unknown> | null} repo — linked repo row from repos.find (decrypted)
 * @param {Record<string, unknown>} payload — unsent fields fall back to effective saved config
 */
export async function testClaudeCredentials(user, repo, payload = {}) {
  const effective = {
    anthropic_api_key:
      pick(payload.anthropic_api_key, repo?.anthropic_api_key ?? user?.anthropic_api_key) || null,
    anthropic_auth_token:
      pick(
        payload.anthropic_auth_token,
        repo?.anthropic_auth_token ?? user?.anthropic_auth_token
      ) || null,
    anthropic_base_url: normalizeAnthropicBaseUrl(
      pick(
        payload.anthropic_base_url,
        firstNonEmpty(repo?.anthropic_base_url, user?.anthropic_base_url)
      )
    ),
  };

  const env = buildClaudeTestEnv(user, effective);
  const result = await runClaudeConnectivityTest(env, {
    baseUrl: effective.anthropic_base_url,
  });
  const { anthropic_api_key, anthropic_auth_token, ...nonSecrets } = effective;
  result.effective = {
    ...nonSecrets,
    anthropic_api_key_configured: Boolean(anthropic_api_key),
    anthropic_auth_token_configured: Boolean(anthropic_auth_token),
  };
  return result;
}

export async function testCursorCredentials(user, repo, payload = {}) {
  const apiKey = pick(payload.cursor_api_key, repo?.cursor_api_key ?? user?.cursor_api_key) || null;
  const result = await runCursorConnectivityTest({ apiKey });
  result.effective = { cursor_api_key_configured: Boolean(apiKey) };
  return result;
}

export async function testPiCredentials(user, repo, payload = {}) {
  const effective = resolvePiEffectiveForTest(user, repo, payload);
  return runPiConnectivityTest(user, effective);
}
