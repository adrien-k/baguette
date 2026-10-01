import { coerceModelParams } from '../../shared/agent-session-defaults.js';
import { resolveVariantForStoredParams } from '../../shared/model-variants.js';

/**
 * Params to pass to the Cursor SDK for one agent run (model id and params are already a pair).
 *
 * @param {{
 *   models: Array<{ id: string, variants?: Array<{ params?: object[] }> }>,
 *   modelId: string,
 *   modelParams: string | object[] | null | undefined,
 *   cursorModelPrefs?: Record<string, string>,
 * }} input
 * @returns {Array<{ id: string, value: string }> | null}
 */
export function resolveCursorAgentModelParams({ models, modelId, modelParams, cursorModelPrefs }) {
  const coerced = coerceModelParams(modelParams);
  const modelObj = models.find((m) => m.id === modelId);
  const variants = modelObj?.variants ?? [];

  if (!variants.length) {
    return coerced;
  }

  const resolved = resolveVariantForStoredParams(variants, coerced, cursorModelPrefs);
  return resolved?.length ? resolved : coerced;
}
