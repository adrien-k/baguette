import { resolveVariantForStoredParams } from '@baguette/shared/model-variants.js';

export {
  applyParamOverrides,
  resolveVariantForStoredParams,
  orderedParamIdsFromVariants,
  paramValueOptionsFromVariants,
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
  } catch {
    // not JSON-encoded model field
  }
  return model;
}
