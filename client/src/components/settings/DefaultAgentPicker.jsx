import { useEffect } from 'react';
import SessionModelSelect from '../SessionModelSelect.jsx';
import { useAgentConfigModels } from '../../hooks/useAgentConfigModels.js';
import { useCursorModelPrefs } from '../../hooks/useAgentPreferences.js';
import { defaultModelForSdk } from '../../utils/models.js';
import { localStateFromConfigDefault } from '../../utils/agentConfigDefaultModel.js';

export default function DefaultAgentPicker({
  title,
  description,
  inheritLabel,
  configId,
  onConfigIdChange,
  model,
  modelParamsJson,
  onModelChange,
  onModelParamsJsonChange,
  configOptions,
  excludeConfigId = null,
  allowInherit = true,
}) {
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

  const nullPlaceholder = <span className="text-xs text-faint truncate">{inheritLabel}</span>;

  return (
    <div className="space-y-3 rounded-lg border border-line bg-control/30 p-4">
      <div>
        <h4 className="text-sm font-medium text-fg">{title}</h4>
        <p className="text-xs text-faint mt-0.5">{description}</p>
      </div>
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
        nullPlaceholder={nullPlaceholder}
        onClear={allowInherit ? handleClear : undefined}
        modelsLoading={!isUnset && modelsStale && !models.length}
        disabled={!isUnset && modelsStale && !models.length}
        className="min-w-0 max-w-full"
      />
    </div>
  );
}
