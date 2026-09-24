/** Applies the user's global Cursor fast/effort preference on top of a variant's params. */
export function applyParamOverrides(params, fast, effort) {
  if (fast === 'default' && effort === 'default') return params;
  const overrides = new Map();
  if (fast !== 'default') overrides.set('fast', fast === 'yes' ? 'true' : 'false');
  if (effort !== 'default') overrides.set('effort', effort);
  return params.map((p) => (overrides.has(p.id) ? { ...p, value: overrides.get(p.id) } : p));
}

/** Picks the variant index matching is_default with the user's fast/effort preference applied. */
export function pickPreferredVariantIdx(variants, fast, effort) {
  if (!variants?.length) return -1;
  const defaultIdx = variants.findIndex((v) => v.is_default);
  const baseIdx = defaultIdx >= 0 ? defaultIdx : 0;
  const baseVariant = variants[baseIdx];
  if (!baseVariant) return baseIdx;
  const mergedStr = JSON.stringify(applyParamOverrides(baseVariant.params || [], fast, effort));
  const withPrefIdx = variants.findIndex((v) => JSON.stringify(v.params) === mergedStr);
  return withPrefIdx >= 0 ? withPrefIdx : baseIdx;
}

export function variantLabel(variant, modelDisplayName) {
  if (variant.display_name && variant.display_name !== modelDisplayName) {
    return variant.display_name;
  }
  return variant.params?.map((p) => `${p.id}:${p.value}`).join(', ') || variant.display_name || '';
}

/**
 * Resolves Cursor model_params JSON for a new session using preferences and optional override.
 */
export function resolveCursorModelParams({
  models,
  modelId,
  modelParamsJson,
  variantIndex,
  cursorFast,
  cursorEffort,
}) {
  const modelObj = models.find((m) => m.id === modelId);
  const variants = modelObj?.variants ?? [];
  if (!variants.length) return undefined;

  let idx = -1;
  if (typeof variantIndex === 'number' && variantIndex >= 0 && variantIndex < variants.length) {
    idx = variantIndex;
  } else if (modelParamsJson) {
    idx = variants.findIndex((v) => {
      try {
        return JSON.stringify(v.params) === modelParamsJson;
      } catch {
        return false;
      }
    });
  }
  if (idx < 0) {
    idx = pickPreferredVariantIdx(variants, cursorFast, cursorEffort);
  }
  const variant = idx >= 0 ? variants[idx] : null;
  if (!variant) return undefined;
  const params = applyParamOverrides(variant.params ?? [], cursorFast, cursorEffort);
  return params.length ? JSON.stringify(params) : undefined;
}
