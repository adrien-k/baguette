export {
  applyParamOverrides,
  pickPreferredVariantIdx,
  variantLabel,
  resolveCursorModelParams,
} from '@baguette/shared/model-variants.js';

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
