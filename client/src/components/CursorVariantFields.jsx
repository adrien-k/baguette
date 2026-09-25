import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { applyParamOverrides } from '../utils/models.js';
import CursorVariantDropdown from './CursorVariantDropdown.jsx';

/**
 * Cursor variant list dropdown + fast/effort preference chips (builder / review).
 */
export default function CursorVariantFields({
  variants = [],
  modelDisplayName,
  variantIdx,
  onVariantIdxChange,
  cursorFast,
  cursorEffort,
  onCursorFastChange,
  onCursorEffortChange,
  disabled = false,
}) {
  const [prefsExpanded, setPrefsExpanded] = useState(false);

  const selectedVariant =
    variantIdx != null && variants[variantIdx] != null ? variants[variantIdx] : null;

  const retryVariantWithPreference = (newFast, newEffort) => {
    const baseParams = selectedVariant?.params ?? [];
    const mergedParams = applyParamOverrides(baseParams, newFast, newEffort);
    const mergedStr = JSON.stringify(mergedParams);
    const withPreferenceVariantIdx = variants.findIndex((v) => {
      try {
        return JSON.stringify(v.params) === mergedStr;
      } catch {
        return false;
      }
    });
    if (withPreferenceVariantIdx >= 0) onVariantIdxChange(withPreferenceVariantIdx);
  };

  return (
    <div className="mt-1 ml-px">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <CursorVariantDropdown
          variants={variants}
          modelDisplayName={modelDisplayName}
          variantIdx={variantIdx}
          onVariantIdxChange={onVariantIdxChange}
          disabled={disabled}
          placement="bottom-start"
          trigger="text"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPrefsExpanded((v) => !v)}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:pointer-events-none"
        >
          <span>preferences</span>
          <ChevronDown
            className={`w-2.5 h-2.5 transition-transform ${prefsExpanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      {prefsExpanded && (
        <div className="mt-1.5 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-zinc-500 w-10">fast:</span>
            {['default', 'yes', 'no'].map((val) => (
              <button
                key={val}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onCursorFastChange(val);
                  retryVariantWithPreference(val, cursorEffort);
                }}
                className={`px-2.5 py-1 rounded text-xs transition-colors border disabled:opacity-50 ${
                  cursorFast === val
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
                }`}
              >
                {val}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-zinc-500 w-10">effort:</span>
            {['default', 'low', 'medium', 'high', 'xhigh'].map((val) => (
              <button
                key={val}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onCursorEffortChange(val);
                  retryVariantWithPreference(cursorFast, val);
                }}
                className={`px-2.5 py-1 rounded text-xs transition-colors border disabled:opacity-50 ${
                  cursorEffort === val
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
                }`}
              >
                {val}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
