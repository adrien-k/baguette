import { useEffect, useMemo, useState } from 'react';
import LightChipDropdown from './LightChipDropdown.jsx';
import ComposerParamPicker from './ComposerParamPicker.jsx';
import Tooltip from './Tooltip.jsx';
import { ParamToggleSwitch } from './ComposerParamControls.jsx';
import {
  pickPreferredVariantIdx,
  orderedParamIdsFromVariants,
  paramValueOptionsFromVariants,
  formatParamDisplayValue,
  formatParamLabel,
  isBinaryParamOptions,
  resolveParamsAfterParamChange,
} from '../utils/models.js';
import { prefKeyForParamId, prefValueFromParamValue } from '../utils/agentPreferences.js';
import { hasCursorModelPricing } from '@baguette/shared/cursor-model-pricing.js';
import {
  AGENT_SDK_IDS,
  agentSdkCredentialTooltip,
  hasAgentSdkCredential,
} from '@baguette/shared/agent-sdk-credentials.js';

function parseSessionModelParams(session) {
  if (!session?.model_params) return null;
  try {
    return JSON.parse(session.model_params);
  } catch {
    return null;
  }
}

const SDK_LABELS = { claude: 'Claude', cursor: 'Cursor' };

const AUTO_PUSH_TOOLTIP =
  'Disable auto-push to avoid pushing every agent commit and spare CI cycles.';

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

function currentVariantIndex(variants, sessionParams, cursorModelPrefs) {
  if (!variants.length) return 0;
  if (sessionParams) {
    const idx = variants.findIndex((v) =>
      v.params?.every((p) => sessionParams.some((sp) => sp.id === p.id && sp.value === p.value))
    );
    if (idx >= 0) return idx;
  }
  const prefIdx = pickPreferredVariantIdx(variants, cursorModelPrefs);
  return prefIdx >= 0 ? prefIdx : 0;
}

function resolvedModelParams(sessionParams, variants, variantIdx) {
  if (sessionParams?.length) return sessionParams;
  const v = variants[variantIdx];
  return v?.params?.length ? v.params : [];
}

/**
 * Session model + per-param picker beside the chat Send control.
 */
export default function SessionModelSelect({
  session,
  models,
  cursorModelPrefs,
  onCursorModelPrefChange,
  onModelChange,
  onAutoPushChange,
  showAutoPushParam = false,
  availableSdks,
  userSettings,
  sdkRepo,
  onSdkChange,
  disabled = false,
  className = '',
}) {
  const [pendingModelId, setPendingModelId] = useState(null);

  useEffect(() => {
    setPendingModelId(null);
  }, [session?.model, session?.model_params]);

  const isCursor = session?.agent_sdk === 'cursor';
  const sessionModelId = session?.model || null;
  const sessionParams = parseSessionModelParams(session);
  const selectedModelId = pendingModelId ?? sessionModelId;
  const selectedModelObj = models.find((m) => m.id === selectedModelId);
  const variants = selectedModelObj?.variants ?? [];
  const currentVariantIdx = currentVariantIndex(variants, sessionParams, cursorModelPrefs);
  const orderedParamIds = orderedParamIdsFromVariants(variants);
  const currentParams = resolvedModelParams(sessionParams, variants, currentVariantIdx);

  const modelTriggerLabel =
    selectedModelObj?.display_name || selectedModelId || (models.length ? 'Model' : '…');

  const pricingKnown =
    !isCursor || (selectedModelId && hasCursorModelPricing(selectedModelId, currentParams));

  const modelOptions = useMemo(() => {
    const opts = models.map((m) => ({ value: m.id, label: m.display_name }));
    if (selectedModelId && !models.some((m) => m.id === selectedModelId)) {
      opts.push({ value: selectedModelId, label: selectedModelId });
    }
    return opts;
  }, [models, selectedModelId]);

  const sdkOptions = useMemo(() => {
    if (userSettings != null) {
      return AGENT_SDK_IDS.map((sdk) => {
        const configured = hasAgentSdkCredential(sdk, userSettings, sdkRepo);
        return {
          value: sdk,
          label: SDK_LABELS[sdk] ?? sdk,
          disabled: !configured,
          title: configured ? undefined : agentSdkCredentialTooltip(sdk),
        };
      });
    }
    return (availableSdks ?? []).map((sdk) => ({
      value: sdk,
      label: SDK_LABELS[sdk] ?? sdk,
    }));
  }, [userSettings, sdkRepo, availableSdks]);

  const showSdkPicker =
    onSdkChange &&
    (userSettings != null ? true : Boolean(availableSdks && availableSdks.length > 0));
  const isSmUp = useMediaQuery('(min-width: 640px)');
  const showAutoPush = showAutoPushParam && onAutoPushChange;
  const autoPushOn = !!session?.auto_push;

  const autoPushPickerItem = useMemo(() => {
    if (!showAutoPush) return null;
    return {
      id: 'auto-push',
      kind: 'toggle',
      label: formatParamLabel('auto-push'),
      currentValue: autoPushOn ? 'on' : 'off',
      valueLabel: autoPushOn ? 'on' : 'off',
      options: [
        { value: 'on', label: 'on' },
        { value: 'off', label: 'off' },
      ],
      onSelect: (value) => onAutoPushChange(value === 'on'),
    };
  }, [showAutoPush, autoPushOn, onAutoPushChange]);

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

  if (!session?.agent_sdk && !showSdkPicker) return null;

  const pickModel = (newId) => {
    if (disabled) return;
    const newModelObj = models.find((m) => m.id === newId);
    const newVariants = newModelObj?.variants ?? [];
    if (isCursor && newVariants.length) {
      const prefIdx = pickPreferredVariantIdx(newVariants, cursorModelPrefs);
      const prefVariant = prefIdx >= 0 ? newVariants[prefIdx] : null;
      setPendingModelId(newId);
      onModelChange(newId, prefVariant?.params?.length ? JSON.stringify(prefVariant.params) : null);
    } else {
      setPendingModelId(null);
      onModelChange(newId);
    }
  };

  return (
    <div className={`flex w-full min-w-0 max-w-full flex-col ${className}`}>
      <div
        className={`flex w-full min-w-0 max-w-full items-center ${showSdkPicker ? 'gap-2' : 'gap-0.5'}`}
      >
        {showSdkPicker && (
          <div className="min-w-[56px] max-w-[40%] shrink-0 overflow-hidden">
            <LightChipDropdown
              layout="list"
              value={session?.agent_sdk ?? ''}
              onChange={onSdkChange}
              options={sdkOptions}
              selectedDisplay={{
                label: SDK_LABELS[session?.agent_sdk] ?? session?.agent_sdk ?? 'Agent',
              }}
              ariaLabel="Choose agent SDK"
              placement="top-start"
              triggerTitle="Agent for this session"
              disabled={disabled}
              shrinkableTrigger
              triggerClassName="text-xs text-faint hover:text-secondary leading-none py-1 disabled:opacity-50 disabled:pointer-events-none max-w-full"
            />
          </div>
        )}
        <div className="min-w-0 flex-1 overflow-hidden">
          <LightChipDropdown
            layout="list"
            value={selectedModelId ?? ''}
            onChange={pickModel}
            options={modelOptions}
            selectedDisplay={{ label: modelTriggerLabel }}
            ariaLabel="Choose model"
            placement="top-start"
            triggerTitle={modelTriggerLabel}
            disabled={disabled}
            shrinkableTrigger
            triggerClassName="text-xs text-faint hover:text-secondary leading-none py-1 disabled:opacity-50 disabled:pointer-events-none min-w-[70px] max-w-full"
          />
        </div>

        {(showInlineAutoPush || showParamPicker) && (
          <div className="shrink-0 flex items-center">
            {showInlineAutoPush && (
              <Tooltip content={AUTO_PUSH_TOOLTIP} wrap placement="top">
                <span className="inline-flex items-center p-1">
                  <ParamToggleSwitch
                    checked={autoPushOn}
                    disabled={disabled}
                    ariaLabel="Auto-push"
                    onToggle={() => onAutoPushChange(!autoPushOn)}
                  />
                </span>
              </Tooltip>
            )}
            {showParamPicker && (
              <ComposerParamPicker
                items={dropdownItems}
                disabled={disabled}
                placement="top-start"
              />
            )}
          </div>
        )}
      </div>
      {isCursor && selectedModelId && !pricingKnown && (
        <p
          className="text-[11px] leading-tight text-accent/85 pt-0.5 truncate"
          title="This model is not in Baguette's Cursor pricing table, so token usage will not be converted to an estimated cost."
        >
          No pricing data for this model — session cost will not be estimated.
        </p>
      )}
    </div>
  );
}
