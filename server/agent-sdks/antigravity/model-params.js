import { coerceModelParams } from '../../../shared/agent-session-defaults.js';
import {
  paramMapFromParamsArray,
  parseModelParamsJson,
} from '../../../shared/agent-model-pricing.js';
import { resolveVariantForStoredParams } from '../../../shared/model-variants.js';

const THOUGHT_LEVEL_SUFFIX_RE = /-(none|minimal|low|medium|high|xhigh|max)$/i;

/**
 * Strip a trailing Antigravity thought-level suffix (e.g. `gemini-3.8-flash-low` → `gemini-3.8-flash`).
 * @param {string | null | undefined} modelId
 * @returns {string | null | undefined}
 */
export function stripAntigravityThoughtSuffix(modelId) {
  if (!modelId) return modelId;
  return String(modelId).replace(THOUGHT_LEVEL_SUFFIX_RE, '');
}

/**
 * Extract the selected thought level (`reasoning` / `thought_level` / `effort`) from `model_params`.
 * @param {unknown} modelParams
 * @returns {string | undefined}
 */
export function antigravityThoughtLevelFromModelParams(modelParams) {
  let map = {};
  if (Array.isArray(modelParams)) {
    map = paramMapFromParamsArray(modelParams);
  } else if (typeof modelParams === 'string') {
    map = parseModelParamsJson(modelParams);
  }
  const level = map.reasoning ?? map.thought_level ?? map.effort;
  return level ? String(level) : undefined;
}

/**
 * @param {{
 *   models: Array<{ id: string, variants?: Array<{ params?: object[] }> }>,
 *   modelId: string,
 *   modelParams: string | object[] | null | undefined,
 * }} input
 */
export function resolveAntigravityAgentModelParams({ models, modelId, modelParams }) {
  const coerced = coerceModelParams(modelParams);
  const modelObj = models.find((m) => m.id === modelId);
  const variants = modelObj?.variants ?? [];

  if (!variants.length) {
    return coerced;
  }

  const resolved = resolveVariantForStoredParams(variants, coerced, {});
  return resolved?.length ? resolved : coerced;
}
