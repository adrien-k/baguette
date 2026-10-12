import { parseModelParamsJson, paramMapFromParamsArray } from './agent-model-pricing.js';

function paramMapFromModelParams(modelParams) {
  if (Array.isArray(modelParams)) return paramMapFromParamsArray(modelParams);
  if (typeof modelParams === 'string') return parseModelParamsJson(modelParams);
  return {};
}

/**
 * @param {string | Array<{ id: string, value: string }> | null | undefined} modelParams
 * @returns {string | undefined}
 */
export function piThinkingLevelFromModelParams(modelParams) {
  const map = paramMapFromModelParams(modelParams);
  const level = map.reasoning ?? map.thinking_level ?? map.thinking;
  return level ? String(level) : undefined;
}
