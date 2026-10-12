import { paramMapFromParamsArray, parseModelParamsJson } from './agent-model-pricing.js';

const CONTEXT_1M_BETA = 'context-1m-2025-08-07';

function paramMapFromModelParams(modelParams) {
  if (Array.isArray(modelParams)) return paramMapFromParamsArray(modelParams);
  if (typeof modelParams === 'string') return parseModelParamsJson(modelParams);
  return {};
}

/**
 * @param {string | Array<{ id: string, value: string }> | null | undefined} modelParams
 */
export function claudeSdkOptionsFromModelParams(modelParams) {
  const map = paramMapFromModelParams(modelParams);

  const options = {};

  if (map.effort) {
    options.effort = map.effort;
  }

  if (map.context === '1m') {
    options.betas = [CONTEXT_1M_BETA];
  }

  if (map.fast === 'true') {
    options.fastMode = true;
  } else if (map.fast === 'false') {
    options.fastMode = false;
  }

  return options;
}

/**
 * Apply session-scoped Claude Code flag settings from stored model params.
 *
 * @param {{ applyFlagSettings?: (settings: Record<string, unknown>) => Promise<void> }} queryInstance
 * @param {string | Array<{ id: string, value: string }> | null | undefined} modelParams
 */
export async function applyClaudeModelParamsToQueryInstance(queryInstance, modelParams) {
  if (!queryInstance?.applyFlagSettings) return;
  const map = paramMapFromModelParams(modelParams);

  const settings = {};
  if (map.effort) settings.effortLevel = map.effort;
  if (map.fast === 'true') settings.fastMode = true;
  if (map.fast === 'false') settings.fastMode = false;
  if (!Object.keys(settings).length) return;
  await queryInstance.applyFlagSettings(settings);
}
