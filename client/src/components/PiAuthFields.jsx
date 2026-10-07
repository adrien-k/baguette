import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_PI_API_KEY_ENV_VAR,
  PI_API_KEY_ENV_VARS,
} from '@baguette/shared/pi-api-key-env-vars.js';
import MaskedSecretInput from './MaskedSecretInput.jsx';
import SearchableSelect from './SearchableSelect';
import AgentTestButton from './AgentTestButton.jsx';

/**
 * Pi credential fields (API key env var + secret) for Settings → Agent and Onboarding.
 */
export default function PiAuthFields({
  maskedApiKey = null,
  savedEnvVar = '',
  repoId = null,
  perRepoHint = false,
  resetKey = 'default',
  onChange,
}) {
  const envOptions = useMemo(
    () =>
      PI_API_KEY_ENV_VARS.map((e) => ({
        value: e.env,
        label: `${e.label} (${e.env})`,
      })),
    []
  );

  const effectiveSaved = savedEnvVar?.trim() || DEFAULT_PI_API_KEY_ENV_VAR;
  const [envVar, setEnvVar] = useState(effectiveSaved);
  const [envVarDirty, setEnvVarDirty] = useState(false);
  const [apiKey, setApiKey] = useState(null);
  const [apiKeyDirty, setApiKeyDirty] = useState(false);

  useEffect(() => {
    setEnvVar(effectiveSaved);
    setEnvVarDirty(false);
    setApiKey(null);
    setApiKeyDirty(false);
  }, [maskedApiKey, effectiveSaved]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const patch = {};
  if (apiKeyDirty) patch.pi_api_key = apiKey ?? '';
  if (envVarDirty) patch.pi_api_key_env_var = envVar;

  const patchRef = useRef('');
  useEffect(() => {
    const json = JSON.stringify(patch);
    if (json === patchRef.current) return;
    patchRef.current = json;
    onChangeRef.current?.(patch, Object.keys(patch).length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, apiKeyDirty, envVar, envVarDirty]);

  const perRepo = perRepoHint ? ' Per-repo values override your account default.' : '';

  const testFields = {
    ...(apiKeyDirty ? { pi_api_key: apiKey ?? '' } : {}),
    ...(envVarDirty ? { pi_api_key_env_var: envVar } : {}),
  };

  return (
    <div key={resetKey}>
      <div>
        <label className="block text-sm font-medium text-secondary mb-1">Provider env var</label>
        <SearchableSelect
          options={envOptions}
          value={envVar}
          onChange={(val) => {
            setEnvVar(val);
            setEnvVarDirty(val !== effectiveSaved);
          }}
          getOptionValue={(o) => o.value}
          getOptionLabel={(o) => o.label}
          placeholder="Select provider…"
        />
        <p className="mt-1 text-xs text-faint">
          Which environment variable Pi uses for your API key (see{' '}
          <a
            href="https://pi.dev/docs/latest/providers#use-an-api-key-from-the-environment"
            className="text-link hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Pi providers
          </a>
          ).{perRepo}
        </p>
      </div>
      <div className="mt-4">
        <label className="block text-sm font-medium text-secondary mb-1">API key</label>
        <MaskedSecretInput
          maskedValue={maskedApiKey}
          placeholder="Provider API key"
          onChange={(val, dirty) => {
            setApiKey(val);
            setApiKeyDirty(dirty);
          }}
        />
        <p className="mt-1 text-xs text-faint">
          Stored encrypted and injected as <code className="text-fg-muted">{envVar}</code> during Pi
          sessions.{perRepo}
        </p>
      </div>
      <div className="mt-4">
        <AgentTestButton sdk="pi" repoId={repoId} fields={testFields} />
      </div>
    </div>
  );
}
