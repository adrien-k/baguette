import { useEffect, useMemo, useState } from 'react';
import LightChipDropdown from './LightChipDropdown.jsx';
import CursorVariantDropdown from './CursorVariantDropdown.jsx';
import { pickPreferredVariantIdx } from '../utils/models.js';

function parseSessionModelParams(session) {
  if (!session?.model_params) return null;
  try {
    return JSON.parse(session.model_params);
  } catch {
    return null;
  }
}

function currentVariantIndex(variants, sessionParams, cursorFast, cursorEffort) {
  if (!variants.length) return 0;
  if (sessionParams) {
    const idx = variants.findIndex((v) =>
      v.params?.every((p) => sessionParams.some((sp) => sp.id === p.id && sp.value === p.value))
    );
    if (idx >= 0) return idx;
  }
  const prefIdx = pickPreferredVariantIdx(variants, cursorFast, cursorEffort);
  return prefIdx >= 0 ? prefIdx : 0;
}

/**
 * Session model + Cursor variant pickers beside the chat Send control.
 */
export default function SessionModelSelect({
  session,
  models,
  cursorFast,
  cursorEffort,
  onModelChange,
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
  const currentVariantIdx = currentVariantIndex(variants, sessionParams, cursorFast, cursorEffort);

  const modelTriggerLabel =
    selectedModelObj?.display_name || selectedModelId || (models.length ? 'Model' : '…');

  const modelOptions = useMemo(() => {
    const opts = models.map((m) => ({ value: m.id, label: m.display_name }));
    if (selectedModelId && !models.some((m) => m.id === selectedModelId)) {
      opts.push({ value: selectedModelId, label: selectedModelId });
    }
    return opts;
  }, [models, selectedModelId]);

  if (!session?.agent_sdk) return null;

  const pickModel = (newId) => {
    if (disabled) return;
    const newModelObj = models.find((m) => m.id === newId);
    const newVariants = newModelObj?.variants ?? [];
    if (isCursor && newVariants.length) {
      const prefIdx = pickPreferredVariantIdx(newVariants, cursorFast, cursorEffort);
      const prefVariant = prefIdx >= 0 ? newVariants[prefIdx] : null;
      setPendingModelId(newId);
      onModelChange(newId, prefVariant?.params?.length ? JSON.stringify(prefVariant.params) : null);
    } else {
      setPendingModelId(null);
      onModelChange(newId);
    }
  };

  const pickVariant = (idx) => {
    if (disabled) return;
    const v = variants[idx];
    if (!v || !selectedModelId) return;
    onModelChange(selectedModelId, v.params?.length ? JSON.stringify(v.params) : null);
  };

  return (
    <div className={`flex items-center gap-0.5 min-w-0 max-w-full ${className}`}>
      <LightChipDropdown
        layout="list"
        value={selectedModelId ?? ''}
        onChange={pickModel}
        options={modelOptions}
        selectedDisplay={{ label: modelTriggerLabel }}
        ariaLabel="Choose model"
        placement="top-start"
        triggerTitle="Model for the next message"
        disabled={disabled}
        shrinkableTrigger
        triggerClassName="text-xs text-zinc-500 hover:text-zinc-300 leading-none py-1 disabled:opacity-50 disabled:pointer-events-none min-w-[70px] max-w-full"
      />

      {isCursor && variants.length > 0 && (
        <CursorVariantDropdown
          variants={variants}
          modelDisplayName={selectedModelObj?.display_name}
          variantIdx={currentVariantIdx}
          onVariantIdxChange={pickVariant}
          placement="top-start"
          trigger="icon"
          disabled={disabled}
        />
      )}
    </div>
  );
}
