import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import Modal, { ModalActions, ModalHeader } from '../../components/Modal.jsx';
import MaskedSecretInput from '../../components/MaskedSecretInput.jsx';
import Field from '../../components/Field.jsx';
import TextInput from '../../components/TextInput.jsx';
import SearchableSelect from '../../components/SearchableSelect';
import AgentTestButton from '../../components/AgentTestButton.jsx';
import AgentConfigDefaultModelPicker from './AgentConfigDefaultModelPicker.jsx';
import AgentConfigLogoPicker from './AgentConfigLogoPicker.jsx';
import { agentConfigsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { sdkDisplayName } from '@baguette/shared/agent-config-labels.js';
import { isMockAgentSdkEnabled } from '@baguette/shared/mock-agent-sdk.js';
import {
  CLAUDE_API_KEY_ENV_OPTIONS,
  defaultAgentConfigApiKeyEnvVar,
  PI_API_KEY_ENV_VARS,
} from '@baguette/shared/agent-config-api-key-env.js';
import {
  buildAgentConfigConnectivityRequest,
  buildAgentConfigCredentialOverrides,
} from '../../utils/agentConfigCredentialOverrides.js';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';
import { INPUT_CLASS } from '../../utils/ui.js';

const BASE_SDK_OPTIONS = [
  { value: 'claude', label: 'Claude' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'pi', label: 'Pi' },
];

export default function AgentConfigModal({ onClose, config, onSaved, onConfigUpdated, onDelete }) {
  const isEdit = Boolean(config?.id);
  const [liveConfig, setLiveConfig] = useState(config);
  const [label, setLabel] = useState('');
  const [sdk, setSdk] = useState('claude');
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState(null);
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [apiKeyEnvVar, setApiKeyEnvVar] = useState(defaultAgentConfigApiKeyEnvVar('claude'));
  const [extraEnvJson, setExtraEnvJson] = useState('');
  const [logo, setLogo] = useState(null);
  const [saving, setSaving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [draftDefaultModel, setDraftDefaultModel] = useState(null);

  const sdkOptions = useMemo(() => {
    const opts = [...BASE_SDK_OPTIONS];
    if (isMockAgentSdkEnabled()) opts.push({ value: 'mock', label: 'Mock' });
    return opts;
  }, []);

  const piEnvOptions = useMemo(
    () =>
      PI_API_KEY_ENV_VARS.map((e) => ({
        value: e.env,
        label: `${e.label} (${e.env})`,
      })),
    []
  );

  useEffect(() => {
    setLiveConfig(config);
    if (config) {
      setLabel(config.label ?? '');
      setSdk(config.sdk ?? 'claude');
      setApiUrl(config.api_url ?? '');
      setApiKey(null);
      setApiKeyDirty(false);
      setApiKeyEnvVar(
        config.sdk === 'cursor'
          ? defaultAgentConfigApiKeyEnvVar('claude')
          : (config.api_key_env_var ?? defaultAgentConfigApiKeyEnvVar(config.sdk ?? 'claude'))
      );
      setExtraEnvJson(
        config.extra_env_json
          ? typeof config.extra_env_json === 'string'
            ? config.extra_env_json
            : JSON.stringify(config.extra_env_json, null, 2)
          : ''
      );
      setLogo(config.logo ?? null);
      setMoreOpen(
        Boolean(config.api_url?.trim()) ||
          Boolean(
            config.extra_env_json &&
            String(
              typeof config.extra_env_json === 'string'
                ? config.extra_env_json
                : JSON.stringify(config.extra_env_json)
            ).trim()
          )
      );
      return;
    }
    setLabel(sdkDisplayName('claude'));
    setSdk('claude');
    setApiUrl('');
    setApiKey(null);
    setApiKeyDirty(false);
    setApiKeyEnvVar(defaultAgentConfigApiKeyEnvVar('claude'));
    setExtraEnvJson('');
    setLogo(null);
    setMoreOpen(false);
    setDraftDefaultModel(null);
  }, [config]);

  useEffect(() => {
    if (isEdit) return;
    setLabel(sdkDisplayName(sdk));
    setApiKeyEnvVar(defaultAgentConfigApiKeyEnvVar(sdk));
  }, [sdk, isEdit]);

  const handleConfigPatched = (updated) => {
    setLiveConfig(updated);
    onConfigUpdated?.(updated);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        label: label.trim(),
        sdk,
        api_url: sdk === 'claude' ? apiUrl.trim() || null : null,
        api_key_env_var:
          sdk === 'cursor' || sdk === 'mock'
            ? null
            : apiKeyEnvVar.trim() || defaultAgentConfigApiKeyEnvVar(sdk),
      };
      if (extraEnvJson.trim()) {
        try {
          JSON.parse(extraEnvJson);
          payload.extra_env_json = extraEnvJson.trim();
        } catch {
          toastError('Invalid extra env JSON', new Error('Must be valid JSON object'));
          setSaving(false);
          return;
        }
      } else {
        payload.extra_env_json = null;
      }
      if (apiKeyDirty) payload.api_key = apiKey ?? '';
      payload.logo = logo;
      if (draftDefaultModel) payload.default_model = draftDefaultModel;

      const saved = isEdit
        ? await agentConfigsService.patch(config.id, payload)
        : await agentConfigsService.create(payload);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toastError(
        isEdit ? 'Failed to update agent configuration' : 'Failed to create agent configuration',
        err
      );
    } finally {
      setSaving(false);
    }
  };

  const secretPlaceholder =
    sdk === 'cursor' ? 'cursor-…' : sdk === 'pi' ? 'provider API key' : 'sk-ant-…';

  const pickerConfig = liveConfig?.id ? liveConfig : null;
  const agentConfigId = config?.id ?? liveConfig?.id ?? null;

  const credentialOverrides = useMemo(
    () =>
      buildAgentConfigCredentialOverrides({
        sdk,
        savedConfig: config,
        apiUrl,
        apiKey,
        apiKeyDirty,
        apiKeyEnvVar,
      }),
    [sdk, config, apiUrl, apiKey, apiKeyDirty, apiKeyEnvVar]
  );

  const connectivityRequest = useMemo(
    () =>
      buildAgentConfigConnectivityRequest({
        sdk,
        savedConfig: config,
        apiUrl,
        apiKey,
        apiKeyDirty,
        apiKeyEnvVar,
        agentConfigId,
      }),
    [sdk, config, apiUrl, apiKey, apiKeyDirty, apiKeyEnvVar, agentConfigId]
  );

  return (
    <Modal maxWidth="max-w-lg" padding="p-5">
      <ModalHeader
        title={isEdit ? 'Edit agent configuration' : 'Add agent configuration'}
        onClose={onClose}
        disabled={saving}
      />
      <Field label="Label" hint="Max 20 characters, unique per account.">
        <TextInput maxLength={20} value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="SDK">
        <select
          className={INPUT_CLASS}
          value={sdk}
          disabled={isEdit}
          onChange={(e) => setSdk(e.target.value)}
        >
          {sdkOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Logo" hint="Shown in the model picker; defaults to the SDK mark.">
        <AgentConfigLogoPicker sdk={sdk} value={logo} onChange={setLogo} disabled={saving} />
      </Field>
      {sdk === 'claude' ? (
        <Field label="Credential type">
          <select
            className={INPUT_CLASS}
            value={apiKeyEnvVar}
            onChange={(e) => setApiKeyEnvVar(e.target.value)}
          >
            {CLAUDE_API_KEY_ENV_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} ({o.value})
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {sdk === 'pi' ? (
        <Field label="Provider env var">
          <SearchableSelect
            options={piEnvOptions}
            value={apiKeyEnvVar}
            onChange={setApiKeyEnvVar}
            getOptionValue={(o) => o.value}
            getOptionLabel={(o) => o.label}
            placeholder="Select provider…"
          />
        </Field>
      ) : null}
      {sdk !== 'mock' ? (
        <Field label="API key">
          <MaskedSecretInput
            maskedValue={config?.api_key ?? null}
            placeholder={secretPlaceholder}
            onChange={(val, dirty) => {
              setApiKey(val);
              setApiKeyDirty(dirty);
            }}
          />
        </Field>
      ) : null}
      <Field label="Connection">
        <AgentTestButton sdk={sdk} testRequest={connectivityRequest} />
      </Field>
      <Field
        label="Default model"
        hint="Pre-selected when you switch to this configuration in a session."
      >
        <AgentConfigDefaultModelPicker
          config={pickerConfig ?? { sdk, default_model: draftDefaultModel }}
          sdk={sdk}
          agentConfigId={agentConfigId}
          credentialFields={credentialOverrides}
          onConfigChange={handleConfigPatched}
          onDraftDefaultModelChange={setDraftDefaultModel}
          disabled={saving}
        />
      </Field>
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-heading transition-colors"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${moreOpen ? 'rotate-90' : ''}`} />
          More options
        </button>
        {moreOpen && (
          <div className="mt-3 space-y-4">
            {sdk === 'claude' ? (
              <Field label="API base URL">
                <TextInput
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="https://api.anthropic.com"
                />
              </Field>
            ) : null}
            <Field label="Extra env (JSON)" className="mb-0">
              <textarea
                className={`${INPUT_CLASS} font-mono text-xs min-h-[80px]`}
                value={extraEnvJson}
                onChange={(e) => setExtraEnvJson(e.target.value)}
                placeholder='{"MY_VAR": "value"}'
              />
            </Field>
          </div>
        )}
      </div>
      <ModalActions className="flex items-center justify-between gap-2 mt-4">
        {isEdit && onDelete ? (
          <button
            type="button"
            className="text-sm text-danger hover:text-danger/90 disabled:opacity-50"
            onClick={onDelete}
            disabled={saving}
          >
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST_BUTTON_CLASS} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className={PRIMARY_BUTTON_SIZED}
            onClick={handleSave}
            disabled={saving || !label.trim()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </ModalActions>
    </Modal>
  );
}
