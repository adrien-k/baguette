export function parseModelField(model) {
  if (!model) return null;
  try {
    const parsed = JSON.parse(model);
    if (parsed?.id) return parsed.id;
  } catch {}
  return model;
}

export function parseModelFieldFull(model) {
  if (!model) return { id: null, params: null };
  try {
    const parsed = JSON.parse(model);
    if (parsed?.id) return { id: parsed.id, params: parsed.params || null };
  } catch {}
  return { id: model, params: null };
}

export function variantLabel(variant, modelDisplayName) {
  if (variant.display_name && variant.display_name !== modelDisplayName) {
    return variant.display_name;
  }
  return variant.params?.map((p) => `${p.id}:${p.value}`).join(', ') || variant.display_name || '';
}

/** Applies the user's global Cursor fast/effort preference on top of a variant's params. */
export function applyParamOverrides(params, fast, effort) {
  if (fast === 'default' && effort === 'default') return params;
  const overrides = new Map();
  if (fast !== 'default') overrides.set('fast', fast === 'yes' ? 'true' : 'false');
  if (effort !== 'default') overrides.set('effort', effort);
  // Only update params that already exist in the variant — never inject new ones
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
