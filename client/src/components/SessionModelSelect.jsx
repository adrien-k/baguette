import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { ParamPrefClearButton } from './ComposerParamControls.jsx';
import LightChipDropdown from './LightChipDropdown.jsx';
import ComposerParamPicker from './ComposerParamPicker.jsx';
import Tooltip from './Tooltip.jsx';
import { ParamToggleSwitch } from './ComposerParamControls.jsx';
import AgentConfigLogo from './AgentConfigLogo.jsx';
import {
  orderedParamIdsFromVariants,
  paramValueOptionsFromVariants,
  formatParamDisplayValue,
  formatParamLabel,
  isBinaryParamOptions,
  paramsJsonForModelChange,
  resolveParamsAfterParamChange,
  resolveVariantForStoredParams,
} from '../utils/models.js';
import { prefKeyForParamId, prefValueFromParamValue } from '../utils/agentPreferences.js';
import { hasAgentModelPricing } from '@baguette/shared/agent-model-pricing.js';
import { formatAgentSdkDisplayName } from '@baguette/shared/agent-sdk-display.js';
import { DROPDOWN_PANEL_CLASS } from '../utils/dropdownPanel.js';

function parseModelParams(params) {
  if (params == null || params === '') return null;
  if (typeof params === 'string') {
    try {
      return JSON.parse(params);
    } catch {
      return null;
    }
  }
  if (Array.isArray(params)) return params;
  return null;
}

const AUTO_PUSH_TOOLTIP =
  'Disable auto-push to avoid pushing every agent commit and spare CI cycles.';
const AUTO_PUSH_LOCAL_TOOLTIP = 'Auto-push is not available for local repositories.';

function AgentSubmenu({ options, value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const currentLabel = current?.label ?? (value ? formatAgentSdkDisplayName(value) : 'Agent');

  return (
    <div className="relative border-b border-strong">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setOpen((v) => !v);
        }}
        className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${
          open ? 'bg-control-hover/80 text-heading' : 'text-secondary hover:bg-control/60'
        } disabled:opacity-50 disabled:pointer-events-none`}
      >
        <span className="text-faint shrink-0">Agent</span>
        <AgentConfigLogo sdk={current?.sdk} logo={current?.logo} className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-heading">{currentLabel}</span>
        <ChevronRight className="w-3 h-3 shrink-0 text-faint" />
      </button>
      {open && (
        <div className="absolute z-10 left-full top-0 pl-1">
          <div role="menu" className={`min-w-[7.5rem] ${DROPDOWN_PANEL_CLASS} py-1`}>
            {options.map((opt) => {
              const selected = opt.value === value;
              const optionDisabled = disabled || opt.disabled;
              const item = (
                <button
                  type="button"
                  role="menuitem"
                  disabled={optionDisabled}
                  title={opt.title}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (optionDisabled) return;
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                    selected
                      ? 'text-fg bg-control-hover'
                      : 'text-fg-muted hover:text-fg hover:bg-control/50'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <AgentConfigLogo
                      sdk={opt.sdk}
                      logo={opt.logo}
                      className="w-3.5 h-3.5 shrink-0"
                    />
                    {opt.label}
                  </span>
                </button>
              );
              if (opt.disabled && opt.title) {
                return (
                  <Tooltip key={opt.value} content={opt.title} wrap placement="left">
                    <span className="block w-full">{item}</span>
                  </Tooltip>
                );
              }
              return <div key={opt.value}>{item}</div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/**
 * Model + per-param picker beside the chat Send control.
 */
export default function SessionModelSelect({
  /** Agent config id (string), or SDK id when no config picker is shown. */
  agentConfigKey,
  model,
  params,
  autoPush = false,
  models,
  cursorModelPrefs,
  onCursorModelPrefChange,
  onModelChange,
  onAutoPushChange,
  autoPushDisabled = false,
  showAutoPushParam = false,
  agentConfigOptions,
  onAgentConfigChange,
  /** When set and `agentConfigKey` is empty, the trigger shows this instead of a model label (picker still opens). */
  nullPlaceholder = null,
  /** Clears agent/model selection; shows a clear control when `nullPlaceholder` is set and a config is selected. */
  onClear,
  disabled = false,
  className = '',
}) {
  const isUnset = Boolean(nullPlaceholder) && (agentConfigKey == null || agentConfigKey === '');
  const selectedAgentConfig = isUnset
    ? null
    : agentConfigOptions?.find((o) => String(o.key) === String(agentConfigKey));
  const agentSdk = selectedAgentConfig?.sdk ?? (isUnset ? null : agentConfigKey);
  const isCursor = agentSdk === 'cursor';
  const isPi = agentSdk === 'pi';
  const usesAgentPricingTable = isCursor || isPi;
  const selectedModelId = model || null;
  const selectedModelObj = models.find((m) => m.id === selectedModelId);
  const variants = useMemo(() => selectedModelObj?.variants ?? [], [selectedModelObj]);
  const currentParams = useMemo(
    () => resolveVariantForStoredParams(variants, parseModelParams(params), cursorModelPrefs) ?? [],
    [variants, params, cursorModelPrefs]
  );
  const orderedParamIds = orderedParamIdsFromVariants(variants);

  const modelTriggerLabel = isUnset
    ? typeof nullPlaceholder === 'string'
      ? nullPlaceholder
      : 'Choose agent…'
    : selectedModelObj?.display_name || selectedModelId || (models.length ? 'Model' : '…');

  const pricingKnown =
    !usesAgentPricingTable ||
    (selectedModelId && hasAgentModelPricing(selectedModelId, currentParams));

  const modelOptions = useMemo(() => {
    const opts = models.map((m) => ({ value: m.id, label: m.display_name }));
    if (selectedModelId && !models.some((m) => m.id === selectedModelId)) {
      opts.push({ value: selectedModelId, label: selectedModelId });
    }
    return opts;
  }, [models, selectedModelId]);

  const agentConfigMenuOptions = useMemo(
    () =>
      (agentConfigOptions ?? []).map((opt) => ({
        value: opt.key,
        label: opt.label ?? opt.key,
        sdk: opt.sdk,
        logo: opt.logo ?? null,
      })),
    [agentConfigOptions]
  );

  const showAgentConfigPicker = Boolean(onAgentConfigChange && agentConfigOptions?.length);
  const isSmUp = useMediaQuery('(min-width: 640px)');
  const showAutoPush = showAutoPushParam && onAutoPushChange;
  const autoPushOn = !!autoPush;

  const autoPushPickerItem = useMemo(() => {
    if (!showAutoPush) return null;
    return {
      id: 'auto-push',
      kind: 'toggle',
      label: formatParamLabel('auto-push'),
      currentValue: autoPushOn ? 'on' : 'off',
      valueLabel: autoPushOn ? 'on' : 'off',
      disabled: autoPushDisabled,
      options: [
        { value: 'on', label: 'on' },
        { value: 'off', label: 'off' },
      ],
      onSelect: (value) => {
        if (autoPushDisabled) return;
        onAutoPushChange(value === 'on');
      },
    };
  }, [showAutoPush, autoPushOn, autoPushDisabled, onAutoPushChange]);

  const cursorParamItems = useMemo(() => {
    const items = [];
    if (isCursor && variants.length > 0) {
      for (const paramId of orderedParamIds) {
        const valueOptions = paramValueOptionsFromVariants(variants, paramId, currentParams);
        const currentValue =
          currentParams.find((p) => p.id === paramId)?.value ?? valueOptions[0] ?? '';
        const options = valueOptions.map((value) => ({
          value,
          label: formatParamDisplayValue(paramId, value),
        }));
        items.push({
          id: paramId,
          kind: isBinaryParamOptions(valueOptions) ? 'toggle' : 'menu',
          label: formatParamLabel(paramId),
          currentValue,
          valueLabel: formatParamDisplayValue(paramId, currentValue),
          options,
          onSelect: (value) => {
            if (!selectedModelId || disabled) return;
            const prefKey = prefKeyForParamId(paramId);
            if (prefKey && onCursorModelPrefChange) {
              onCursorModelPrefChange(prefKey, prefValueFromParamValue(paramId, value));
            }
            const resolved = resolveParamsAfterParamChange(
              variants,
              currentParams,
              paramId,
              value,
              orderedParamIds
            );
            onModelChange(selectedModelId, resolved.length ? JSON.stringify(resolved) : null);
          },
        });
      }
    }
    return items;
  }, [
    isCursor,
    variants,
    orderedParamIds,
    currentParams,
    selectedModelId,
    disabled,
    onCursorModelPrefChange,
    onModelChange,
  ]);

  const dropdownItems = useMemo(() => {
    const items = [];
    if (autoPushPickerItem && !isSmUp) items.push(autoPushPickerItem);
    items.push(...cursorParamItems);
    return items;
  }, [autoPushPickerItem, isSmUp, cursorParamItems]);

  const showInlineAutoPush = showAutoPush && isSmUp;
  const showParamPicker = dropdownItems.length > 0;

  const showClear = Boolean(nullPlaceholder && onClear && !isUnset);

  if (!agentConfigKey && !showAgentConfigPicker && !nullPlaceholder) return null;

  const pickModel = (newId) => {
    if (disabled || isUnset || !newId || newId === selectedModelId) return;
    const newModelObj = models.find((m) => m.id === newId);
    onModelChange(newId, paramsJsonForModelChange(newModelObj, cursorModelPrefs));
  };

  const pickAgentConfig = (nextKey) => {
    if (disabled || !nextKey || nextKey === agentConfigKey || !onAgentConfigChange) return;
    onAgentConfigChange(nextKey);
  };

  return (
    <div className={`relative flex w-full min-w-0 max-w-full flex-col ${className}`}>
      <div className="flex w-full min-w-0 max-w-full items-center gap-0.5">
        <div className="flex min-w-0 items-center gap-0">
          <div className="min-w-0 overflow-hidden">
            <LightChipDropdown
              layout="list"
              value={selectedModelId ?? ''}
              onChange={pickModel}
              options={modelOptions}
              header={
                showAgentConfigPicker ? (
                  <AgentSubmenu
                    options={agentConfigMenuOptions}
                    value={agentConfigKey ?? ''}
                    onChange={pickAgentConfig}
                    disabled={disabled}
                  />
                ) : null
              }
              selectedDisplay={{
                label:
                  isUnset && typeof nullPlaceholder !== 'string' ? undefined : modelTriggerLabel,
                content:
                  isUnset && typeof nullPlaceholder !== 'string' ? nullPlaceholder : undefined,
                icon: isUnset ? null : (
                  <AgentConfigLogo
                    sdk={selectedAgentConfig?.sdk ?? agentSdk}
                    logo={selectedAgentConfig?.logo ?? null}
                  />
                ),
              }}
              ariaLabel={showAgentConfigPicker ? 'Choose agent and model' : 'Choose model'}
              placement="top-start"
              triggerTitle={modelTriggerLabel}
              disabled={disabled}
              shrinkableTrigger
              triggerClassName="text-xs text-faint hover:text-secondary leading-none py-1 disabled:opacity-50 disabled:pointer-events-none min-w-[70px] max-w-full"
            />
          </div>
          {showParamPicker && (
            <ComposerParamPicker items={dropdownItems} disabled={disabled} placement="top-start" />
          )}
          {showClear && (
            <ParamPrefClearButton
              visible
              ariaLabel="Clear agent and model"
              onClear={() => onClear()}
            />
          )}
        </div>

        {showInlineAutoPush && (
          <Tooltip
            content={autoPushDisabled ? AUTO_PUSH_LOCAL_TOOLTIP : AUTO_PUSH_TOOLTIP}
            wrap
            placement="top"
          >
            <span className="inline-flex items-center p-1">
              <ParamToggleSwitch
                checked={autoPushOn}
                disabled={disabled || autoPushDisabled}
                ariaLabel="Auto-push"
                onToggle={() => {
                  if (autoPushDisabled) return;
                  onAutoPushChange(!autoPushOn);
                }}
              />
            </span>
          </Tooltip>
        )}
      </div>
      {usesAgentPricingTable && selectedModelId && !pricingKnown && (
        <p
          className="pointer-events-none absolute left-0 right-0 top-full z-10 truncate text-[11px] leading-tight text-accent/85"
          title="This model is not in Baguette's agent model pricing table, so token usage will not be converted to an estimated cost."
        >
          No pricing data for this model — session cost will not be estimated.
        </p>
      )}
    </div>
  );
}
