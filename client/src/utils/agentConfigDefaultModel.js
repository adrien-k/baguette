import { parseAgentDefaultModelJson } from '@baguette/shared/agent-default-model.js';
import { stringifyModelParams } from './models.js';

/**
 * Session/builder model fields from an agent config's default_model.
 * When no default is set, returns {} unless clearIfMissing is true.
 */
export function modelPatchFromConfigDefault(
  config,
  { modelKey = 'model', paramsKey = 'model_params', clearIfMissing = false } = {}
) {
  const parsed = parseAgentDefaultModelJson(config?.default_model);
  if (parsed.model) {
    return {
      [modelKey]: parsed.model,
      [paramsKey]: stringifyModelParams(parsed.model_params),
    };
  }
  if (clearIfMissing) {
    return { [modelKey]: null, [paramsKey]: null };
  }
  return {};
}

/** Local picker state (model id + params JSON) from a config's default_model. */
export function localStateFromConfigDefault(config) {
  const parsed = parseAgentDefaultModelJson(config?.default_model);
  return {
    model: parsed.model || '',
    modelParamsJson: parsed.model_params?.length ? JSON.stringify(parsed.model_params) : null,
  };
}

/** API payload for agent_configs.default_model from composer picker values. */
export function defaultModelPayloadFromPicker(modelId, modelParamsJson) {
  if (!modelId) return null;
  let model_params = null;
  if (modelParamsJson) {
    try {
      const parsed =
        typeof modelParamsJson === 'string' ? JSON.parse(modelParamsJson) : modelParamsJson;
      if (Array.isArray(parsed) && parsed.length) model_params = parsed;
    } catch {
      model_params = null;
    }
  }
  return { model: modelId, model_params };
}
