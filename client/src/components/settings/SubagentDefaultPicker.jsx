import { useCallback, useEffect, useState } from 'react';
import { agentModelPresetsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { AgentDefaultModelPicker } from './DefaultAgentPicker.jsx';
import {
  SUBAGENT_DEFAULT_ANY,
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
    label: 'Inherit the default',
    description:
      'Subagents use this session’s primary builder model. New sessions and loops use the builder default. A preset can still override one call.',
  },
  {
    value: SUBAGENT_DEFAULT_CONFIG,
    label: 'Fixed model',
    description:
      'Every agent-created subagent, session, and loop uses this model. A preset can still override one call.',
  },
  {
    value: SUBAGENT_DEFAULT_PRESET,
    label: 'Presets only',
    description: 'The agent must choose a saved preset for each subagent, session, and loop.',
  },
  {
    value: SUBAGENT_DEFAULT_ANY,
    label: 'Any preset or model',
    description: 'The agent chooses a saved preset, or any model from your agent configurations.',
  },
];

function RadioCard({ selected, children }) {
  const tone = selected ? RADIO_CARD_SELECTED : RADIO_CARD_IDLE;
  return <div className={`rounded-md border px-3 py-2 transition-colors ${tone}`}>{children}</div>;
}

function ModeRadio({ opt, selected, onModeChange }) {
  return (
    <label className="flex gap-2 cursor-pointer">
      <input
        type="radio"
        name="agent-created-model-mode"
        className="mt-0.5"
        checked={selected}
        onChange={() => onModeChange(opt.value)}
      />
      <span className="min-w-0">
        <span className="text-sm font-medium text-heading">{opt.label}</span>
        <span className="block text-[11px] text-faint mt-0.5">{opt.description}</span>
      </span>
    </label>
  );
}

function PresetChoices({ presets, presetsLoading, configOptions }) {
  if (presetsLoading) {
    return <p className="text-xs text-faint">Loading presets…</p>;
  }
  if (presets.length === 0) {
    return <p className="text-xs text-faint">No preset models yet. Add some above.</p>;
  }
  return (
    <ul className="text-xs text-secondary space-y-1 max-h-40 overflow-y-auto">
      {presets.map((p) => (
        <li key={p.id} className="truncate">
          <span className="font-medium text-heading">{p.description}</span>
          <span className="text-faint">
            {' '}
            ·{' '}
            {formatAgentSdkDisplayName(
              configOptions.find((c) => Number(c.key) === Number(p.agent_config_id))?.sdk ?? 'agent'
            )}{' '}
            · {p.model}
          </span>
        </li>
      ))}
    </ul>
  );
}

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
  const showPresets =
    normalizedMode === SUBAGENT_DEFAULT_PRESET || normalizedMode === SUBAGENT_DEFAULT_ANY;

  const loadPresets = useCallback(() => {
    setPresetsLoading(true);
    agentModelPresetsService
      .find({ query: { $limit: 50, $sort: { id: 1 } } })
      .then((res) => setPresets(res.data ?? res))
      .catch((err) => toastError('Failed to load preset models', err))
      .finally(() => setPresetsLoading(false));
  }, []);

  useEffect(() => {
    if (showPresets) {
      loadPresets();
    }
  }, [showPresets, loadPresets]);

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
        <h4 className="text-sm font-medium text-fg">Agent-created sessions and subagents</h4>
        <p className="text-xs text-faint mt-0.5">{description}</p>
      </div>
      <div className="space-y-2">
        {MODE_OPTIONS.map((opt) => {
          const selected = normalizedMode === opt.value;
          if (opt.value === SUBAGENT_DEFAULT_CONFIG) {
            return (
              <RadioCard key={opt.value} selected={selected}>
                <ModeRadio opt={opt} selected={selected} onModeChange={onModeChange} />
                {selected ? (
                  <div className="mt-3 pl-6 min-w-0">
                    <AgentDefaultModelPicker {...pickerProps} />
                  </div>
                ) : null}
              </RadioCard>
            );
          }
          if (opt.value === SUBAGENT_DEFAULT_PRESET) {
            return (
              <RadioCard key={opt.value} selected={selected}>
                <ModeRadio opt={opt} selected={selected} onModeChange={onModeChange} />
                {selected ? (
                  <div className="mt-3 pl-6 space-y-2">
                    <p className="text-[11px] text-faint">
                      No preset is selected here. The agent picks one from this list on each call.
                    </p>
                    <PresetChoices
                      presets={presets}
                      presetsLoading={presetsLoading}
                      configOptions={configOptions}
                    />
                  </div>
                ) : null}
              </RadioCard>
            );
          }
          if (opt.value === SUBAGENT_DEFAULT_ANY) {
            return (
              <RadioCard key={opt.value} selected={selected}>
                <ModeRadio opt={opt} selected={selected} onModeChange={onModeChange} />
                {selected ? (
                  <div className="mt-3 pl-6 space-y-3">
                    <p className="text-[11px] text-faint">
                      Nothing is selected here. Each call passes a preset, or an agent configuration
                      and model from ListModels.
                    </p>
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-secondary">Agent configurations</p>
                      {configOptions.length === 0 ? (
                        <p className="text-xs text-faint">No agent configurations yet.</p>
                      ) : (
                        <ul className="text-xs text-secondary space-y-1">
                          {configOptions.map((c) => (
                            <li key={c.key} className="truncate">
                              <span className="font-medium text-heading">{c.label}</span>
                              <span className="text-faint">
                                {' '}
                                · {formatAgentSdkDisplayName(c.sdk)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-secondary">Presets</p>
                      <PresetChoices
                        presets={presets}
                        presetsLoading={presetsLoading}
                        configOptions={configOptions}
                      />
                    </div>
                  </div>
                ) : null}
              </RadioCard>
            );
          }
          return (
            <RadioCard key={opt.value} selected={selected}>
              <ModeRadio opt={opt} selected={selected} onModeChange={onModeChange} />
            </RadioCard>
          );
        })}
      </div>
    </div>
  );
}
