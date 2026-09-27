import {
  CURSOR_PARAM_ORDER,
  DEFAULT_CURSOR_MODEL_PREFS,
  prefKeyForParamId,
} from './cursor-model-prefs.js';

/** @param {string} value */
export function parseContextSizeToken(value) {
  if (value == null || value === '') return null;
  const m = String(value)
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return null;
  let n = Number(m[1]);
  if (m[2] === 'k') n *= 1000;
  if (m[2] === 'm') n *= 1_000_000;
  return n;
}

/** Effort tiers low → max (unknown values sort before `low`). */
export const EFFORT_LEVEL_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Reasoning tiers none → max. */
export const REASONING_LEVEL_ORDER = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'extra-high',
  'max',
];

function tierRank(value, tierOrder) {
  const i = tierOrder.indexOf(value);
  return i >= 0 ? i : -1;
}

/**
 * Tiered pref → concrete value: exact match, else highest available tier strictly below pref.
 * If pref is below every option, use the lowest available tier.
 */
export function tierOptionFromPref(prefValue, options, tierOrder) {
  if (!options?.length) return prefValue;
  if (options.includes(prefValue)) return prefValue;
  const prefRank = tierRank(prefValue, tierOrder);
  if (prefRank < 0) return options[0];

  const ranked = options
    .map((opt) => ({ opt, rank: tierRank(opt, tierOrder) }))
    .filter((x) => x.rank >= 0);

  const below = ranked.filter((x) => x.rank < prefRank).sort((a, b) => b.rank - a.rank);
  if (below.length) return below[0].opt;

  const above = ranked.sort((a, b) => a.rank - b.rank);
  return above.length ? above[0].opt : options[0];
}

export function effortOptionFromPref(prefValue, options) {
  return tierOptionFromPref(prefValue, options, EFFORT_LEVEL_ORDER);
}

export function reasoningOptionFromPref(prefValue, options) {
  return tierOptionFromPref(prefValue, options, REASONING_LEVEL_ORDER);
}

/** Pick the option whose numeric size is closest to `prefValue`. */
export function nearestContextOption(prefValue, options) {
  if (!options?.length) return prefValue;
  const target = parseContextSizeToken(prefValue);
  if (target == null) return options[0];
  let best = options[0];
  let bestDist = Infinity;
  for (const opt of options) {
    const n = parseContextSizeToken(opt);
    if (n == null) continue;
    const dist = Math.abs(n - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = opt;
    }
  }
  return best;
}

function uniqueParamValuesFromVariants(variants, paramId) {
  const values = new Set();
  for (const v of variants ?? []) {
    const p = v.params?.find((x) => x.id === paramId);
    if (p) values.add(p.value);
  }
  return [...values];
}

/**
 * Map a stored preference to a concrete param value for `paramId`.
 * @param {string} paramId
 * @param {string} prefValue
 * @param {{ contextOptions?: string[], effortOptions?: string[], reasoningOptions?: string[] }} [matchOptions]
 */
export function paramValueFromPref(paramId, prefValue, matchOptions = {}) {
  const { contextOptions = [], effortOptions = [], reasoningOptions = [] } = matchOptions;
  if (!prefValue || prefValue === 'default') return undefined;
  if (paramId === 'fast' || paramId === 'thinking' || paramId === 'cyber') {
    return prefValue === 'yes' ? 'true' : prefValue === 'no' ? 'false' : undefined;
  }
  if (paramId === 'context') {
    return nearestContextOption(prefValue, contextOptions);
  }
  if (paramId === 'effort') {
    return effortOptionFromPref(prefValue, effortOptions);
  }
  if (paramId === 'reasoning') {
    return reasoningOptionFromPref(prefValue, reasoningOptions);
  }
  return prefValue;
}

/**
 * Applies the user's global Cursor model preferences on top of a variant's params.
 * @param {object[]} params
 * @param {Record<string, string>} [prefs]
 * @param {object[]} [variants]
 */
export function applyParamOverrides(params, prefs, variants = []) {
  const p = prefs ?? DEFAULT_CURSOR_MODEL_PREFS;
  const contextOptions = uniqueParamValuesFromVariants(variants, 'context');
  const effortOptions = uniqueParamValuesFromVariants(variants, 'effort');
  const reasoningOptions = uniqueParamValuesFromVariants(variants, 'reasoning');
  const overrides = new Map();
  for (const row of params ?? []) {
    const key = prefKeyForParamId(row.id);
    if (!key) continue;
    const resolved = paramValueFromPref(row.id, p[key], {
      contextOptions,
      effortOptions,
      reasoningOptions,
    });
    if (resolved !== undefined) overrides.set(row.id, resolved);
  }
  if (!overrides.size) return params;
  return params.map((row) =>
    overrides.has(row.id) ? { ...row, value: overrides.get(row.id) } : row
  );
}

/** Picks the variant index matching is_default with user preferences applied. */
export function pickPreferredVariantIdx(variants, prefs) {
  if (!variants?.length) return -1;
  const defaultIdx = variants.findIndex((v) => v.is_default);
  const baseIdx = defaultIdx >= 0 ? defaultIdx : 0;
  const baseVariant = variants[baseIdx];
  if (!baseVariant) return baseIdx;
  const mergedStr = JSON.stringify(applyParamOverrides(baseVariant.params || [], prefs, variants));
  const withPrefIdx = variants.findIndex((v) => JSON.stringify(v.params) === mergedStr);
  return withPrefIdx >= 0 ? withPrefIdx : baseIdx;
}

/** Param ids present on variants, in composer order (Fast, Thinking, Effort, Context, Cyber, …). */
export function orderedParamIdsFromVariants(variants) {
  const seen = new Set();
  for (const v of variants ?? []) {
    for (const p of v.params ?? []) seen.add(p.id);
  }
  const ordered = CURSOR_PARAM_ORDER.filter((id) => seen.has(id));
  for (const id of seen) {
    if (!CURSOR_PARAM_ORDER.includes(id)) ordered.push(id);
  }
  return ordered;
}

/** Variant whose params exactly match the given list (order-independent). */
export function findVariantForParams(variants, params) {
  if (!params?.length) return null;
  return (
    (variants ?? []).find(
      (v) =>
        v.params?.length === params.length &&
        params.every((m) => v.params.some((p) => p.id === m.id && p.value === m.value))
    ) ?? null
  );
}

/**
 * Distinct values for `paramId` among variants compatible with the other current param values.
 */
export function paramValueOptionsFromVariants(variants, paramId, currentParams = []) {
  const others = new Map(
    (currentParams ?? []).filter((p) => p.id !== paramId).map((p) => [p.id, p.value])
  );
  const values = new Set();
  for (const v of variants ?? []) {
    const params = v.params ?? [];
    const matchesOthers = [...others.entries()].every(([id, val]) => {
      const p = params.find((x) => x.id === id);
      return p && p.value === val;
    });
    if (!matchesOthers) continue;
    const p = params.find((x) => x.id === paramId);
    if (p) values.add(p.value);
  }
  return [...values];
}

/** After editing one param, return params from a real variant (exact match or same param value). */
export function resolveParamsAfterParamChange(variants, currentParams, paramId, value, orderedIds) {
  const merged = mergeModelParam(currentParams, paramId, value, orderedIds);
  const exact = findVariantForParams(variants, merged);
  if (exact?.params?.length) return exact.params;
  const withParam = (variants ?? []).filter(
    (v) => v.params?.find((p) => p.id === paramId)?.value === value
  );
  if (withParam.length === 1 && withParam[0].params?.length) return withParam[0].params;
  return merged;
}

export function mergeModelParam(params, paramId, value, orderedIds) {
  const map = new Map((params ?? []).map((p) => [p.id, p.value]));
  map.set(paramId, value);
  const ids = orderedIds?.length ? orderedIds : [...map.keys()];
  return ids.filter((id) => map.has(id)).map((id) => ({ id, value: map.get(id) }));
}

export function formatParamDisplayValue(paramId, value) {
  if (paramId === 'fast') {
    if (value === 'true') return 'yes';
    if (value === 'false') return 'no';
  }
  return value;
}

/** User-facing param name in the composer param menu. */
export function formatParamLabel(paramId) {
  if (paramId === 'auto-push') return 'Auto-push';
  const spaced = paramId.replace(/[-_]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const BINARY_VALUE_SETS = [
  new Set(['off', 'on']),
  new Set(['false', 'true']),
  new Set(['no', 'yes']),
];

/** Whether values are a binary pair (on/off, true/false, yes/no). Allows a single option when constrained. */
export function isBinaryParamOptions(valueOptions) {
  if (!valueOptions?.length || valueOptions.length > 2) return false;
  const unique = [...new Set(valueOptions)];
  return BINARY_VALUE_SETS.some((set) => unique.every((v) => set.has(v)));
}

const BINARY_ON_VALUES = new Set(['on', 'true', 'yes']);

export function binaryParamToggleOn(_paramId, currentValue) {
  return BINARY_ON_VALUES.has(currentValue);
}

export function binaryParamToggledValue(currentValue) {
  if (currentValue === 'on') return 'off';
  if (currentValue === 'off') return 'on';
  if (currentValue === 'true') return 'false';
  if (currentValue === 'false') return 'true';
  if (currentValue === 'yes') return 'no';
  if (currentValue === 'no') return 'yes';
  return currentValue;
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
  cursorModelPrefs,
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
    idx = pickPreferredVariantIdx(variants, cursorModelPrefs);
  }
  const variant = idx >= 0 ? variants[idx] : null;
  if (!variant) return undefined;
  const params = applyParamOverrides(variant.params ?? [], cursorModelPrefs, variants);
  return params.length ? JSON.stringify(params) : undefined;
}
