import { coerceModelParams } from './agent-session-defaults.js';

const EMPTY_AGENT_DEFAULT_MODEL = {
  model: null,
  model_params: null,
};

/** Parse users.agent_default_model / reviewer_default_model / agent_configs.default_model (JSON: model + model_params). */
export function parseAgentDefaultModelJson(raw) {
  if (raw == null || raw === '') return { ...EMPTY_AGENT_DEFAULT_MODEL };
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...EMPTY_AGENT_DEFAULT_MODEL };
    }
  }
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_AGENT_DEFAULT_MODEL };
  const model =
    parsed.model == null || parsed.model === ''
      ? null
      : typeof parsed.model === 'string'
        ? parsed.model
        : null;
  return {
    model,
    model_params: coerceModelParams(parsed.model_params),
  };
}

export function stringifyAgentDefaultModel({ model, model_params }) {
  const m = model == null || model === '' ? null : String(model);
  const params = coerceModelParams(model_params);
  if (!m && !params?.length) return null;
  return JSON.stringify({ model: m, model_params: params ?? null });
}
