import { coerceModelParams } from '../../shared/agent-session-defaults.js';
import { resolveVariantForStoredParams } from '../../shared/model-variants.js';

/**
 * @param {{
 *   models: Array<{ id: string, variants?: Array<{ params?: object[] }> }>,
 *   modelId: string,
 *   modelParams: string | object[] | null | undefined,
 * }} input
 */
export function resolvePiAgentModelParams({ models, modelId, modelParams }) {
  const coerced = coerceModelParams(modelParams);
  const modelObj = models.find((m) => m.id === modelId);
  const variants = modelObj?.variants ?? [];

  if (!variants.length) {
    return coerced;
  }

  const resolved = resolveVariantForStoredParams(variants, coerced, {});
  return resolved?.length ? resolved : coerced;
}
