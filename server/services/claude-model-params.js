import { coerceModelParams } from '../../shared/agent-session-defaults.js';
import { resolveVariantForStoredParams } from '../../shared/model-variants.js';

/**
 * @param {{
 *   models: Array<{ id: string, variants?: Array<{ params?: object[] }> }>,
 *   modelId: string,
 *   modelParams: string | object[] | null | undefined,
 *   cursorModelPrefs?: Record<string, string>,
 * }} input
 */
export function resolveClaudeAgentModelParams({ models, modelId, modelParams, cursorModelPrefs }) {
  const coerced = coerceModelParams(modelParams);
  const modelObj = models.find((m) => m.id === modelId);
  const variants = modelObj?.variants ?? [];

  if (!variants.length) {
    return coerced;
  }

  const resolved = resolveVariantForStoredParams(variants, coerced, cursorModelPrefs);
  return resolved?.length ? resolved : coerced;
}
