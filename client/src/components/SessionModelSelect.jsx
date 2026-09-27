import { useEffect, useMemo, useState } from 'react';
import LightChipDropdown from './LightChipDropdown.jsx';
import ComposerParamPicker from './ComposerParamPicker.jsx';
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

function parseSessionModelParams(session) {
  if (!session?.model_params) return null;
  try {
    return JSON.parse(session.model_params);
  } catch {
    return null;
  }
}

const SDK_LABELS = { claude: 'Claude', cursor: 'Cursor' };

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

  const modelOptions = useMemo(() => {
    const opts = models.map((m) => ({ value: m.id, label: m.display_name }));
    if (selectedModelId && !models.some((m) => m.id === selectedModelId)) {
      opts.push({ value: selectedModelId, label: selectedModelId });
    }
    return opts;
  }, [models, selectedModelId]);

  const sdkOptions = useMemo(
    () =>
      (availableSdks ?? []).map((sdk) => ({
        value: sdk,
        label: SDK_LABELS[sdk] ?? sdk,
      })),
    [availableSdks]
  );

  const showSdkPicker = availableSdks && availableSdks.length > 1 && onSdkChange;

  const paramPickerItems = useMemo(() => {
    const items = [];
    if (showAutoPushParam && onAutoPushChange) {
      const on = !!session?.auto_push;
      items.push({
        id: 'auto-push',
        kind: 'toggle',
        label: formatParamLabel('auto-push'),
        currentValue: on ? 'on' : 'off',
        valueLabel: on ? 'on' : 'off',
        options: [
          { value: 'on', label: 'on' },
          { value: 'off', label: 'off' },
        ],
        onSelect: (value) => onAutoPushChange(value === 'on'),
      });
    }
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
    showAutoPushParam,
    onAutoPushChange,
    session?.auto_push,
    isCursor,
    variants,
    orderedParamIds,
    currentParams,
    selectedModelId,
    disabled,
    onCursorModelPrefChange,
    onModelChange,
  ]);

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
    <div
      className={`flex w-full min-w-0 max-w-full items-center ${showSdkPicker ? 'gap-2' : 'gap-0.5'} ${className}`}
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
            triggerClassName="text-xs text-zinc-500 hover:text-zinc-300 leading-none py-1 disabled:opacity-50 disabled:pointer-events-none max-w-full"
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
          triggerClassName="text-xs text-zinc-500 hover:text-zinc-300 leading-none py-1 disabled:opacity-50 disabled:pointer-events-none min-w-[70px] max-w-full"
        />
      </div>

      {paramPickerItems.length > 0 && (
        <div className="shrink-0">
          <ComposerParamPicker items={paramPickerItems} disabled={disabled} placement="top-start" />
        </div>
      )}
    </div>
  );
}
