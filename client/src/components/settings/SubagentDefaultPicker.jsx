import { useCallback, useEffect, useState } from 'react';
import { agentModelPresetsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { AgentDefaultModelPicker } from './DefaultAgentPicker.jsx';
import {
  SUBAGENT_DEFAULT_CONFIG,
  SUBAGENT_DEFAULT_INHERIT,
  SUBAGENT_DEFAULT_PRESET,
  normalizeSubagentDefaultMode,
} from '@baguette/shared/subagent-default-mode.js';
import { formatAgentSdkDisplayName } from '@baguette/shared/agent-sdk-display.js';
import { useAgentConfigs } from '../../hooks/useAgentConfigs.js';

const RADIO_CARD_SELECTED = 'border-brand/50 bg-brand/10';
const RADIO_CARD_IDLE = 'border-line';

const MODE_OPTIONS = [
  {
    value: SUBAGENT_DEFAULT_INHERIT,
    label: 'Inherit from session',
    description: 'MCP subagents use the session primary builder configuration and model.',
  },
  {
    value: SUBAGENT_DEFAULT_CONFIG,
    label: 'Set explicit model',
    description: 'Fixed agent configuration and model for every MCP subagent.',
  },
  {
    value: SUBAGENT_DEFAULT_PRESET,
    label: 'Let the agent pick a preset model',
    description:
      'The calling agent chooses a preset per task (ListPresetModels) and passes preset_model_id.',
  },
];

export default function SubagentDefaultPicker({
  description,
  mode,
  onModeChange,
  configId,
  onConfigIdChange,
  model,
  modelParamsJson,
  onModelChange,
  onModelParamsJsonChange,
}) {
  const { configOptions } = useAgentConfigs();
  const normalizedMode = normalizeSubagentDefaultMode(mode);
  const [presets, setPresets] = useState([]);
  const [presetsLoading, setPresetsLoading] = useState(false);

  const loadPresets = useCallback(() => {
    setPresetsLoading(true);
    agentModelPresetsService
      .find({ query: { $limit: 50, $sort: { id: 1 } } })
      .then((res) => setPresets(res.data ?? res))
      .catch((err) => toastError('Failed to load preset models', err))
      .finally(() => setPresetsLoading(false));
  }, []);

  useEffect(() => {
    if (normalizedMode === SUBAGENT_DEFAULT_PRESET) {
      loadPresets();
    }
  }, [normalizedMode, loadPresets]);

  const pickerProps = {
    configId,
    onConfigIdChange,
    model,
    modelParamsJson,
    onModelChange,
    onModelParamsJsonChange,
    allowInherit: false,
    inheritLabel: 'Select a configuration',
    showInheritPlaceholder: true,
  };

  return (
    <div className="space-y-3 rounded-lg border border-line bg-control/30 p-4">
      <div>
        <h4 className="text-sm font-medium text-fg">Subagent default</h4>
        <p className="text-xs text-faint mt-0.5">{description}</p>
      </div>
      <div className="space-y-2">
        {MODE_OPTIONS.map((opt) => {
          if (opt.value === SUBAGENT_DEFAULT_CONFIG) {
            return (
              <div
                key={opt.value}
                className={`rounded-md border px-3 py-2 transition-colors ${
                  normalizedMode === opt.value ? RADIO_CARD_SELECTED : RADIO_CARD_IDLE
                }`}
              >
                <label className="flex gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="subagent-default-mode"
                    className="mt-0.5"
                    checked={normalizedMode === opt.value}
                    onChange={() => onModeChange(opt.value)}
                  />
                  <span className="min-w-0">
                    <span className="text-sm font-medium text-heading">{opt.label}</span>
                    <span className="block text-[11px] text-faint mt-0.5">{opt.description}</span>
                  </span>
                </label>
                {normalizedMode === SUBAGENT_DEFAULT_CONFIG ? (
                  <div className="mt-3 pl-6 min-w-0">
                    <AgentDefaultModelPicker {...pickerProps} />
                  </div>
                ) : null}
              </div>
            );
          }
          if (opt.value === SUBAGENT_DEFAULT_PRESET) {
            return (
              <div
                key={opt.value}
                className={`rounded-md border px-3 py-2 transition-colors ${
                  normalizedMode === opt.value ? RADIO_CARD_SELECTED : RADIO_CARD_IDLE
                }`}
              >
                <label className="flex gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="subagent-default-mode"
                    className="mt-0.5"
                    checked={normalizedMode === opt.value}
                    onChange={() => onModeChange(opt.value)}
                  />
                  <span className="min-w-0">
                    <span className="text-sm font-medium text-heading">{opt.label}</span>
                    <span className="block text-[11px] text-faint mt-0.5">{opt.description}</span>
                  </span>
                </label>
                {normalizedMode === SUBAGENT_DEFAULT_PRESET ? (
                  <div className="mt-3 pl-6 space-y-2">
                    <p className="text-[11px] text-faint">
                      No preset is selected here. The agent picks one from this list when starting a
                      subagent.
                    </p>
                    {presetsLoading ? (
                      <p className="text-xs text-faint">Loading presets…</p>
                    ) : presets.length === 0 ? (
                      <p className="text-xs text-faint">No preset models yet. Add some above.</p>
                    ) : (
                      <ul className="text-xs text-secondary space-y-1 max-h-40 overflow-y-auto">
                        {presets.map((p) => (
                          <li key={p.id} className="truncate">
                            <span className="font-medium text-heading">{p.description}</span>
                            <span className="text-faint">
                              {' '}
                              ·{' '}
                              {formatAgentSdkDisplayName(
                                configOptions.find(
                                  (c) => Number(c.key) === Number(p.agent_config_id)
                                )?.sdk ?? 'agent'
                              )}{' '}
                              · {p.model}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            );
          }
          return (
            <label
              key={opt.value}
              className={`flex gap-2 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                normalizedMode === opt.value ? RADIO_CARD_SELECTED : RADIO_CARD_IDLE
              }`}
            >
              <input
                type="radio"
                name="subagent-default-mode"
                className="mt-0.5"
                checked={normalizedMode === opt.value}
                onChange={() => onModeChange(opt.value)}
              />
              <span className="min-w-0">
                <span className="text-sm font-medium text-heading">{opt.label}</span>
                <span className="block text-[11px] text-faint mt-0.5">{opt.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
