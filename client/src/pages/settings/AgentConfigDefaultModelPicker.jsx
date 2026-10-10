import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import SessionModelSelect from '../../components/SessionModelSelect.jsx';
import { agentConfigsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { fetchAgentConfigModels } from '../../utils/fetchAgentSdkModels.js';
import { useCursorModelPrefs } from '../../hooks/useAgentPreferences.js';
import {
  defaultModelPayloadFromPicker,
  localStateFromConfigDefault,
} from '../../utils/agentConfigDefaultModel.js';
import { TEXT_FAINT } from '../../utils/ui.js';

export default function AgentConfigDefaultModelPicker({
  config,
  agentConfigId = config?.id ?? null,
  sdk = config?.sdk ?? 'claude',
  credentialFields = {},
  onConfigChange,
  onDraftDefaultModelChange,
  disabled = false,
}) {
  const { cursorModelPrefs, setCursorModelPref } = useCursorModelPrefs();
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [draftPicker, setDraftPicker] = useState(() => localStateFromConfigDefault(config));

  const isDraft = agentConfigId == null;
  const savedPicker = localStateFromConfigDefault(config);
  const { model, modelParamsJson } = isDraft ? draftPicker : savedPicker;
  const paramsForSelect =
    modelParamsJson ??
    (config?.default_model?.model_params?.length
      ? JSON.stringify(config.default_model.model_params)
      : null);

  useEffect(() => {
    if (!isDraft) return;
    setDraftPicker(localStateFromConfigDefault(config));
  }, [isDraft, config?.default_model]);

  const loadModels = useCallback(
    async (refresh = false, overrides = {}) => {
      if (agentConfigId == null && !sdk) {
        setModels([]);
        return;
      }
      if (refresh) setRefreshing(true);
      else setModelsLoading(true);
      try {
        const list = await fetchAgentConfigModels({
          agentConfigId,
          sdk: agentConfigId == null ? sdk : null,
          refresh,
          credentialFields: overrides,
        });
        setModels(list);
      } catch (err) {
        toastError('Failed to load models', err);
        setModels([]);
      } finally {
        setModelsLoading(false);
        setRefreshing(false);
      }
    },
    [agentConfigId, sdk]
  );

  useEffect(() => {
    void loadModels(false, {});
  }, [loadModels]);

  const handleModelChange = async (modelId, nextParamsJson) => {
    if (isDraft) {
      const payload = defaultModelPayloadFromPicker(modelId, nextParamsJson);
      setDraftPicker({
        model: modelId || '',
        modelParamsJson: nextParamsJson,
      });
      onDraftDefaultModelChange?.(payload);
      return;
    }
    if (!agentConfigId || savingModel) return;
    setSavingModel(true);
    try {
      const default_model = defaultModelPayloadFromPicker(modelId, nextParamsJson);
      const updated = await agentConfigsService.patch(agentConfigId, { default_model });
      onConfigChange?.(updated);
    } catch (err) {
      toastError('Failed to save default model', err);
    } finally {
      setSavingModel(false);
    }
  };

  const busy = disabled || modelsLoading || savingModel;
  const canLoad = agentConfigId != null || (sdk && sdk !== 'mock');

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 min-w-0 max-w-full">
        {canLoad ? (
          <SessionModelSelect
            agentConfigKey={sdk}
            model={model}
            params={paramsForSelect}
            models={models}
            cursorModelPrefs={cursorModelPrefs}
            onCursorModelPrefChange={setCursorModelPref}
            onModelChange={handleModelChange}
            modelsLoading={modelsLoading && !models.length}
            disabled={busy}
            className="min-w-0 flex-1"
          />
        ) : (
          <p className={`text-xs ${TEXT_FAINT} min-w-0 flex-1`}>Mock SDK has no model list.</p>
        )}
        <button
          type="button"
          className={`flex items-center gap-1.5 text-xs ${TEXT_FAINT} hover:text-secondary transition-colors shrink-0 disabled:opacity-40 py-1`}
          disabled={!canLoad || busy || refreshing}
          onClick={() => void loadModels(true, credentialFields)}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh models
        </button>
      </div>
      {canLoad && isDraft ? (
        <p className={`text-xs ${TEXT_FAINT}`}>
          Default model is applied when you save this configuration.
        </p>
      ) : null}
    </div>
  );
}
