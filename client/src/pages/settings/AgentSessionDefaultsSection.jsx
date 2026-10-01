import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api.js';
import { toastError } from '../../utils/toastError.jsx';
import { availableAgentSdks } from '@baguette/shared/agent-sdk-credentials.js';
import { LAST_USED_AGENT_SDK } from '@baguette/shared/agent-session-defaults.js';
import SearchableSelect from '../../components/SearchableSelect';
import AgentSdkIcon from '../../components/svg/AgentSdkIcon.jsx';
import SessionModelSelect from '../../components/SessionModelSelect.jsx';
import { SettingsSaveRow } from '../../components/SettingsSection.jsx';
import { applyParamOverrides, pickPreferredVariantIdx } from '../../utils/models.js';
import { useCursorModelPrefs } from '../../hooks/useAgentPreferences.js';

const SDK_OPTIONS = [
  { value: LAST_USED_AGENT_SDK, label: 'Last used agent' },
  { value: 'claude', label: 'Claude' },
  { value: 'cursor', label: 'Cursor' },
];

export default function AgentSessionDefaultsSection({ settings }) {
  const { cursorModelPrefs, setCursorModelPref } = useCursorModelPrefs();
  const [agentSdk, setAgentSdk] = useState(LAST_USED_AGENT_SDK);
  const [model, setModel] = useState('');
  const [modelParamsJson, setModelParamsJson] = useState(null);
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const isLastUsedMode = agentSdk === LAST_USED_AGENT_SDK;

  const availableSdks = useMemo(
    () => (settings ? availableAgentSdks(settings, null) : []),
    [settings]
  );

  const loadDefaults = useCallback(() => {
    return apiFetch('/api/settings/agent-defaults')
      .then((d) => {
        if (d.use_last_used || !d.agent_sdk) {
          setAgentSdk(LAST_USED_AGENT_SDK);
          setModel('');
          setModelParamsJson(null);
        } else {
          const sdk = availableSdks.includes(d.agent_sdk) ? d.agent_sdk : LAST_USED_AGENT_SDK;
          setAgentSdk(sdk);
          setModel(d.model && sdk !== LAST_USED_AGENT_SDK ? d.model : '');
          setModelParamsJson(d.model_params?.length ? JSON.stringify(d.model_params) : null);
        }
        setDirty(false);
      })
      .catch((err) => toastError('Failed to load session defaults', err));
  }, [availableSdks]);

  useEffect(() => {
    loadDefaults();
  }, [loadDefaults]);

  const loadModels = useCallback(() => {
    if (isLastUsedMode || !agentSdk) {
      setModels([]);
      return Promise.resolve();
    }
    if (!availableSdks.includes(agentSdk)) {
      setModels([]);
      return Promise.resolve();
    }
    const url = agentSdk === 'cursor' ? '/api/settings/models?sdk=cursor' : '/api/settings/models';
    setLoadingModels(true);
    return apiFetch(url)
      .then((d) => setModels(d.models || []))
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false));
  }, [agentSdk, availableSdks, isLastUsedMode]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    if (!models.length) return;
    setModel((prev) => {
      if (prev && models.some((m) => m.id === prev)) return prev;
      return '';
    });
  }, [models]);

  useEffect(() => {
    if (isLastUsedMode || agentSdk !== 'cursor' || !model || modelParamsJson || !models.length)
      return;
    const modelObj = models.find((m) => m.id === model);
    const variants = modelObj?.variants ?? [];
    if (!variants.length) return;
    const prefIdx = pickPreferredVariantIdx(variants, cursorModelPrefs);
    const prefVariant = prefIdx >= 0 ? variants[prefIdx] : variants[0];
    const params = applyParamOverrides(prefVariant?.params ?? [], cursorModelPrefs, variants);
    if (params.length) setModelParamsJson(JSON.stringify(params));
  }, [isLastUsedMode, agentSdk, model, models, cursorModelPrefs, modelParamsJson]);

  const handleSdkChange = (sdk) => {
    setAgentSdk(sdk);
    setModel('');
    setModelParamsJson(null);
    setDirty(true);
  };

  const composerSession = useMemo(
    () => ({
      agent_sdk: isLastUsedMode ? null : agentSdk || null,
      model: model || null,
      model_params: modelParamsJson,
    }),
    [isLastUsedMode, agentSdk, model, modelParamsJson]
  );

  const handleModelChange = (modelId, paramsJson) => {
    setModel(modelId);
    setModelParamsJson(paramsJson ?? null);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      let body;
      if (isLastUsedMode) {
        body = { agent_sdk: null, model: null, model_params: null };
      } else {
        let model_params = null;
        if (agentSdk === 'cursor' && modelParamsJson) {
          try {
            model_params = JSON.parse(modelParamsJson);
          } catch {
            model_params = null;
          }
        }
        body = {
          agent_sdk: agentSdk || null,
          model: agentSdk && model ? model : null,
          model_params:
            agentSdk === 'cursor' && model && model_params?.length ? model_params : null,
        };
      }
      await apiFetch('/api/settings/agent-defaults', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      toastError('Failed to save session defaults', err);
    } finally {
      setSaving(false);
    }
  };

  const sdkSelectOptions = SDK_OPTIONS.filter(
    (o) => o.value === LAST_USED_AGENT_SDK || availableSdks.includes(o.value)
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-secondary mb-1">Default agent</label>
        <SearchableSelect
          value={agentSdk}
          onChange={handleSdkChange}
          options={sdkSelectOptions}
          getOptionValue={(o) => o.value}
          getOptionLabel={(o) => o.label}
          renderSelected={(opt) =>
            opt.value && opt.value !== LAST_USED_AGENT_SDK ? (
              <span className="inline-flex items-center gap-2">
                <AgentSdkIcon sdk={opt.value} />
                {opt.label}
              </span>
            ) : (
              opt.label
            )
          }
          placeholder="Choose default"
        />
        <p className="mt-1 text-xs text-faint">
          <strong className="font-medium text-fg-muted">Last used agent</strong> copies SDK, model,
          and Cursor params from your most recent session when MCP CreateSession omits them. Fixed
          Claude/Cursor choices always use the model and params below.
        </p>
      </div>

      {!isLastUsedMode && agentSdk && (
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">
            Model &amp; params
          </label>
          {loadingModels ? (
            <p className="text-xs text-faint">Loading models…</p>
          ) : (
            <SessionModelSelect
              session={composerSession}
              models={models}
              cursorModelPrefs={cursorModelPrefs}
              onCursorModelPrefChange={setCursorModelPref}
              onModelChange={handleModelChange}
              availableSdks={availableSdks}
              userSettings={settings}
              disabled={!models.length}
            />
          )}
        </div>
      )}

      <SettingsSaveRow saving={saving} saved={saved} onSave={handleSave} disabled={!dirty} />
    </div>
  );
}
