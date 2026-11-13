import { useEffect, useMemo } from 'react';
import SessionModelSelect from '../SessionModelSelect.jsx';
import { useAgentConfigModels } from '../../hooks/useAgentConfigModels.js';
import { useAgentConfigs } from '../../hooks/useAgentConfigs.js';
import { useCursorModelPrefs } from '../../hooks/useAgentPreferences.js';
import { defaultModelForSdk } from '../../utils/models.js';
import { localStateFromConfigDefault } from '../../utils/agentConfigDefaultModel.js';

const MODEL_MODE_INHERIT = 'inherit';
const MODEL_MODE_ACCOUNT = 'account';

const RADIO_CARD_SELECTED = 'border-brand/50 bg-brand/10';
const RADIO_CARD_IDLE = 'border-line';

/** Config + model picker (no mode radios). */
export function AgentDefaultModelPicker({
  configId,
  onConfigIdChange,
  model,
  modelParamsJson,
  onModelChange,
  onModelParamsJsonChange,
  excludeConfigId = null,
  allowInherit = true,
  inheritLabel,
  showInheritPlaceholder = false,
  className = 'min-w-0 max-w-full',
}) {
  const { configOptions } = useAgentConfigs();
  const options =
    excludeConfigId != null
      ? configOptions.filter((c) => Number(c.key) !== Number(excludeConfigId))
      : configOptions;
  const isUnset = configId == null;
  const { models, stale: modelsStale } = useAgentConfigModels(configId, {
    enabled: !isUnset && configId != null,
  });
  const { cursorModelPrefs, setCursorModelPref } = useCursorModelPrefs();

  const handleSdkChange = (nextKey) => {
    onConfigIdChange(Number(nextKey));
    const picked = options.find((c) => c.key === String(nextKey));
    const fromDefault = localStateFromConfigDefault(picked);
    onModelChange(fromDefault.model || null);
    onModelParamsJsonChange(fromDefault.modelParamsJson);
  };

  const handleClear = () => {
    onConfigIdChange(null);
    onModelChange(null);
    onModelParamsJsonChange(null);
  };

  const handleModelChange = (modelId, paramsJson) => {
    onModelChange(modelId || null);
    onModelParamsJsonChange(paramsJson ?? null);
  };

  useEffect(() => {
    if (isUnset || modelsStale || !models.length || !configId) return;
    if (model && models.some((m) => m.id === model)) return;
    const fallback = defaultModelForSdk(models);
    if (!fallback) return;
    onModelChange(fallback.id);
  }, [isUnset, models, modelsStale, configId, model, onModelChange]);

  const nullPlaceholder = inheritLabel ? (
    <span className="text-xs text-faint truncate">{inheritLabel}</span>
  ) : null;

  return (
    <SessionModelSelect
      agentConfigKey={configId != null ? String(configId) : null}
      model={model || ''}
      params={modelParamsJson}
      models={isUnset ? [] : models}
      cursorModelPrefs={cursorModelPrefs}
      onCursorModelPrefChange={setCursorModelPref}
      onModelChange={handleModelChange}
      agentConfigOptions={options}
      onAgentConfigChange={handleSdkChange}
      nullPlaceholder={showInheritPlaceholder ? nullPlaceholder : undefined}
      onClear={allowInherit ? handleClear : undefined}
      modelsLoading={!isUnset && modelsStale && !models.length}
      disabled={!isUnset && modelsStale && !models.length}
      className={className}
    />
  );
}

export default function DefaultAgentPicker({
  title,
  description,
  inheritLabel,
  inheritModeDescription,
  configId,
  onConfigIdChange,
  model,
  modelParamsJson,
  onModelChange,
  onModelParamsJsonChange,
  excludeConfigId = null,
  allowInherit = true,
  /** When set, show inherit vs fixed-configuration radios (builder / reviewer defaults). */
  modelModeRadioName,
  fixedModeLabel = 'Set explicit model',
  fixedModeDescription = 'Store an agent configuration and model for pre-fill.',
}) {
  const { configOptions } = useAgentConfigs();
  const options =
    excludeConfigId != null
      ? configOptions.filter((c) => Number(c.key) !== Number(excludeConfigId))
      : configOptions;
  const isUnset = configId == null;
  const showModelModeRadios = Boolean(modelModeRadioName) && allowInherit;

  const modelMode = isUnset ? MODEL_MODE_INHERIT : MODEL_MODE_ACCOUNT;

  const inheritOption = useMemo(() => {
    if (!showModelModeRadios) return null;
    const inheritText = typeof inheritLabel === 'string' ? inheritLabel : 'Use inherited model';
    return {
      value: MODEL_MODE_INHERIT,
      label: inheritText,
      description:
        inheritModeDescription ??
        'Leave account defaults unset and pre-fill from session history instead.',
    };
  }, [showModelModeRadios, inheritLabel, inheritModeDescription]);

  const explicitOption = useMemo(() => {
    if (!showModelModeRadios) return null;
    return {
      value: MODEL_MODE_ACCOUNT,
      label: fixedModeLabel,
      description: fixedModeDescription,
    };
  }, [showModelModeRadios, fixedModeLabel, fixedModeDescription]);

  const handleClear = () => {
    onConfigIdChange(null);
    onModelChange(null);
    onModelParamsJsonChange(null);
  };

  const handleModelModeChange = (nextMode) => {
    if (nextMode === MODEL_MODE_INHERIT) {
      handleClear();
      return;
    }
    if (configId == null && options.length) {
      const first = options[0];
      onConfigIdChange(Number(first.key));
      const fromDefault = localStateFromConfigDefault(first);
      onModelChange(fromDefault.model || null);
      onModelParamsJsonChange(fromDefault.modelParamsJson);
    }
  };

  const pickerProps = {
    configId,
    onConfigIdChange,
    model,
    modelParamsJson,
    onModelChange,
    onModelParamsJsonChange,
    excludeConfigId,
    allowInherit: false,
  };

  return (
    <div className="space-y-3 rounded-lg border border-line bg-control/30 p-4">
      <div>
        <h4 className="text-sm font-medium text-fg">{title}</h4>
        <p className="text-xs text-faint mt-0.5">{description}</p>
      </div>
      {showModelModeRadios && inheritOption && explicitOption ? (
        <div className="space-y-2">
          <label
            className={`flex gap-2 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
              modelMode === MODEL_MODE_INHERIT ? RADIO_CARD_SELECTED : RADIO_CARD_IDLE
            }`}
          >
            <input
              type="radio"
              name={modelModeRadioName}
              className="mt-0.5"
              checked={modelMode === MODEL_MODE_INHERIT}
              onChange={() => handleModelModeChange(MODEL_MODE_INHERIT)}
            />
            <span className="min-w-0">
              <span className="text-sm font-medium text-heading">{inheritOption.label}</span>
              <span className="block text-[11px] text-faint mt-0.5">
                {inheritOption.description}
              </span>
            </span>
          </label>
          <div
            className={`rounded-md border px-3 py-2 transition-colors ${
              modelMode === MODEL_MODE_ACCOUNT ? RADIO_CARD_SELECTED : RADIO_CARD_IDLE
            }`}
          >
            <label className="flex gap-2 cursor-pointer">
              <input
                type="radio"
                name={modelModeRadioName}
                className="mt-0.5"
                checked={modelMode === MODEL_MODE_ACCOUNT}
                onChange={() => handleModelModeChange(MODEL_MODE_ACCOUNT)}
              />
              <span className="min-w-0">
                <span className="text-sm font-medium text-heading">{explicitOption.label}</span>
                <span className="block text-[11px] text-faint mt-0.5">
                  {explicitOption.description}
                </span>
              </span>
            </label>
            {modelMode === MODEL_MODE_ACCOUNT ? (
              <div className="mt-3 pl-6 min-w-0">
                <AgentDefaultModelPicker {...pickerProps} />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <AgentDefaultModelPicker
          {...pickerProps}
          allowInherit={allowInherit}
          inheritLabel={inheritLabel}
          showInheritPlaceholder={Boolean(inheritLabel)}
        />
      )}
    </div>
  );
}
