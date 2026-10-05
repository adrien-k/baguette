import { useEffect, useRef, useState } from 'react';
import MaskedSecretInput from './MaskedSecretInput.jsx';
import TextInput from './TextInput.jsx';
import AgentTestButton from './AgentTestButton.jsx';

/**
 * Claude credential + gateway fields shared by Settings → Agent and Onboarding.
 * Owns dirty tracking and reports the pending patch to the parent via `onChange`
 * (only fields the user actually changed, so unset fields keep their saved values).
 *
 * Props:
 * - maskedApiKey / maskedAuthToken — masked values for already-saved secrets (null if none)
 * - savedBaseUrl — current non-secret base URL value
 * - repoId — repo scope for the test button (null = account level)
 * - perRepoHint — when true, helper texts mention per-repo overrides (Settings only)
 * - resetKey — change to reset the fields (e.g. repo-scope switch)
 * - onChange(patch, hasChanges)
 */
export default function ClaudeAuthFields({
  maskedApiKey = null,
  maskedAuthToken = null,
  savedBaseUrl = '',
  repoId = null,
  perRepoHint = false,
  resetKey = 'default',
  onChange,
}) {
  const [apiKey, setApiKey] = useState(null);
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [authToken, setAuthToken] = useState(null);
  const [authTokenDirty, setAuthTokenDirty] = useState(false);
  const [baseUrl, setBaseUrl] = useState(savedBaseUrl || '');
  const [baseUrlDirty, setBaseUrlDirty] = useState(false);

  // resetKey remounts via the parent's `key` prop; keep an effect as a safety net for
  // in-place prop changes (e.g. refetched settings after save).
  useEffect(() => {
    setApiKey(null);
    setApiKeyDirty(false);
    setAuthToken(null);
    setAuthTokenDirty(false);
    setBaseUrl(savedBaseUrl || '');
    setBaseUrlDirty(false);
  }, [maskedApiKey, maskedAuthToken, savedBaseUrl]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const patch = {};
  if (apiKeyDirty) patch.anthropic_api_key = apiKey ?? '';
  if (authTokenDirty) patch.anthropic_auth_token = authToken ?? '';
  if (baseUrlDirty) patch.anthropic_base_url = baseUrl.trim();

  const patchRef = useRef('');
  useEffect(() => {
    const json = JSON.stringify(patch);
    if (json === patchRef.current) return;
    patchRef.current = json;
    onChangeRef.current?.(patch, Object.keys(patch).length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, apiKeyDirty, authToken, authTokenDirty, baseUrl, baseUrlDirty]);

  const perRepo = perRepoHint ? ' Per-repo values override your account default.' : '';

  /** Only dirty fields are sent — undefined falls back to the effective saved config. */
  const testFields = {
    ...(apiKeyDirty ? { anthropic_api_key: apiKey ?? '' } : {}),
    ...(authTokenDirty ? { anthropic_auth_token: authToken ?? '' } : {}),
    ...(baseUrlDirty ? { anthropic_base_url: baseUrl.trim() } : {}),
  };

  return (
    <div key={resetKey}>
      <div>
        <label className="block text-sm font-medium text-secondary mb-1">API key</label>
        <MaskedSecretInput
          maskedValue={maskedApiKey}
          placeholder="sk-ant-…"
          onChange={(val, dirty) => {
            setApiKey(val);
            setApiKeyDirty(dirty);
          }}
        />
        <p className="mt-1 text-xs text-faint">
          Console API key (<code className="text-fg-muted">sk-ant-api…</code>). For a subscription
          token from <code className="text-fg-muted">claude setup-token</code>, use the auth token
          field below.{perRepo}
        </p>
      </div>
      <div className="mt-4">
        <label className="block text-sm font-medium text-secondary mb-1">Auth token</label>
        <MaskedSecretInput
          maskedValue={maskedAuthToken}
          placeholder="sk-ant-oat01-… or gateway bearer token"
          onChange={(val, dirty) => {
            setAuthToken(val);
            setAuthTokenDirty(dirty);
          }}
        />
        <p className="mt-1 text-xs text-faint">
          Optional. Subscription token from{' '}
          <code className="text-fg-muted">claude setup-token</code> (
          <code className="text-fg-muted">sk-ant-oat…</code>) or the bearer token your LLM gateway
          expects, sent as <code className="text-fg-muted">ANTHROPIC_AUTH_TOKEN</code>{' '}
          (Authorization: Bearer). Ignored when an API key is set above.{perRepo}
        </p>
      </div>
      <div className="mt-4">
        <label className="block text-sm font-medium text-secondary mb-1">API base URL</label>
        <TextInput
          type="url"
          className="font-mono text-sm"
          placeholder="https://api.anthropic.com"
          value={baseUrl}
          onChange={(e) => {
            setBaseUrl(e.target.value);
            setBaseUrlDirty(true);
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="mt-1 text-xs text-faint">
          Optional. For an LLM gateway compatible with the Anthropic API, set its URL here via{' '}
          <code className="text-fg-muted">ANTHROPIC_BASE_URL</code> (origin only — no{' '}
          <code className="text-fg-muted">/v1</code> suffix) together with the auth token or API key
          it expects. The model list is fetched from the gateway&apos;s{' '}
          <code className="text-fg-muted">/v1/models</code> endpoint.{perRepo}
        </p>
      </div>
      <div className="mt-4">
        <AgentTestButton sdk="claude" repoId={repoId} fields={testFields} />
      </div>
    </div>
  );
}
