import { resolveVariantForStoredParams } from '@baguette/shared/model-variants.js';

export {
  applyParamOverrides,
  pickPreferredVariantIdx,
  variantLabel,
  resolveCursorModelParams,
  findVariantForStoredParams,
  findClosestVariantForParams,
  resolveVariantForStoredParams,
  orderedParamIdsFromVariants,
  paramValueOptionsFromVariants,
  mergeModelParam,
  formatParamDisplayValue,
  resolveParamsAfterParamChange,
  formatParamLabel,
  isBinaryParamOptions,
  binaryParamToggleOn,
  binaryParamToggledValue,
} from '@baguette/shared/model-variants.js';

/** Registry default for an SDK list (`is_default`, else first). */
export function defaultModelForSdk(models) {
  if (!models?.length) return null;
  return models.find((m) => m.is_default) ?? models[0];
}

/**
 * Params JSON for a model after switching to it: closest match to Cursor prefs
 * (or the model's default variant when there is no stored snapshot).
 */
export function paramsJsonForModelChange(modelObj, cursorModelPrefs) {
  const variants = modelObj?.variants ?? [];
  if (!variants.length) return null;
  const params = resolveVariantForStoredParams(variants, null, cursorModelPrefs);
  return params?.length ? JSON.stringify(params) : null;
}

export function stringifyModelParams(params) {
  if (params == null || params === '') return null;
  if (typeof params === 'string') return params;
  if (Array.isArray(params) && params.length) return JSON.stringify(params);
  return null;
}

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
