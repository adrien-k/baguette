import { useEffect, useState } from 'react';
import { ChevronDown, Settings } from 'lucide-react';
import AnchoredMenu from './AnchoredMenu.jsx';
import { variantLabel, pickPreferredVariantIdx } from '../utils/models.js';

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

function chipClassName(selected) {
  return `px-2.5 py-1 rounded text-xs transition-colors border ${
    selected
      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
  }`;
}

const panelClassName =
  'w-64 max-h-72 overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2.5';

/**
 * Session model + Cursor variant pickers beside the chat Send control.
 */
export default function SessionModelSelect({
  session,
  models,
  cursorFast,
  cursorEffort,
  onModelChange,
  className = '',
}) {
  const [modelOpen, setModelOpen] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const [pendingModelId, setPendingModelId] = useState(null);

  useEffect(() => {
    setPendingModelId(null);
  }, [session?.model, session?.model_params]);

  if (!session?.agent_sdk) return null;

  const isCursor = session.agent_sdk === 'cursor';
  const sessionModelId = session.model || null;
  const sessionParams = parseSessionModelParams(session);
  const selectedModelId = pendingModelId ?? sessionModelId;
  const selectedModelObj = models.find((m) => m.id === selectedModelId);
  const variants = selectedModelObj?.variants ?? [];
  const currentVariantIdx = currentVariantIndex(variants, sessionParams, cursorFast, cursorEffort);

  const modelTriggerLabel =
    selectedModelObj?.display_name || selectedModelId || (models.length ? 'Model' : '…');

  const pickModel = (newId) => {
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
    setModelOpen(false);
  };

  const pickVariant = (idx) => {
    const v = variants[idx];
    if (!v || !selectedModelId) return;
    onModelChange(selectedModelId, v.params?.length ? JSON.stringify(v.params) : null);
    setVariantOpen(false);
  };

  return (
    <div className={`flex items-center gap-0.5 shrink-0 ${className}`}>
      <AnchoredMenu
        open={modelOpen}
        onOpenChange={(open) => {
          setModelOpen(open);
          if (open) setVariantOpen(false);
        }}
        placement="top-start"
        className={panelClassName}
        reference={({ ref, referenceProps }) => (
          <button
            type="button"
            ref={ref}
            {...referenceProps}
            onClick={(e) => {
              referenceProps.onClick?.(e);
              setVariantOpen(false);
              setModelOpen((v) => !v);
            }}
            aria-expanded={modelOpen}
            aria-haspopup="dialog"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-0.5 max-w-[7.5rem] sm:max-w-[10rem] leading-none py-1"
            title="Model for the next message"
          >
            <span className="truncate">{modelTriggerLabel}</span>
            <ChevronDown
              className={`w-2.5 h-2.5 shrink-0 transition-transform ${modelOpen ? 'rotate-180' : ''}`}
              strokeWidth={2.5}
            />
          </button>
        )}
      >
        <div role="dialog" aria-label="Choose model" className="flex flex-wrap gap-1.5">
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => pickModel(m.id)}
              className={chipClassName(m.id === selectedModelId)}
            >
              {m.display_name}
            </button>
          ))}
          {selectedModelId && !models.some((m) => m.id === selectedModelId) && (
            <button
              type="button"
              onClick={() => pickModel(selectedModelId)}
              className={chipClassName(true)}
            >
              {selectedModelId}
            </button>
          )}
        </div>
      </AnchoredMenu>

      {isCursor && variants.length > 0 && (
        <AnchoredMenu
          open={variantOpen}
          onOpenChange={(open) => {
            setVariantOpen(open);
            if (open) setModelOpen(false);
          }}
          placement="top-start"
          className={panelClassName}
          reference={({ ref, referenceProps }) => (
            <button
              type="button"
              ref={ref}
              {...referenceProps}
              onClick={(e) => {
                referenceProps.onClick?.(e);
                setModelOpen(false);
                setVariantOpen((v) => !v);
              }}
              aria-expanded={variantOpen}
              aria-haspopup="dialog"
              aria-label="Cursor model variant"
              title={variantLabel(variants[currentVariantIdx], selectedModelObj?.display_name)}
              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/80 transition-colors leading-none"
            >
              <Settings className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          )}
        >
          <div role="dialog" aria-label="Choose variant" className="flex flex-wrap gap-1.5">
            {variants.map((v, i) => (
              <button
                key={i}
                type="button"
                onClick={() => pickVariant(i)}
                className={chipClassName(i === currentVariantIdx)}
              >
                {variantLabel(v, selectedModelObj?.display_name)}
                {v.is_default && <span className="ml-1 text-zinc-500">(default)</span>}
              </button>
            ))}
          </div>
        </AnchoredMenu>
      )}
    </div>
  );
}
