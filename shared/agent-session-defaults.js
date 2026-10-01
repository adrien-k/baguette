export const AGENT_SDK_DEFAULT_VALUES = ['claude', 'cursor'];

export const EMPTY_AGENT_SESSION_DEFAULTS = {
  agent_sdk: null,
  model: null,
  model_params: null,
};

/** UI / API sentinel — stored JSON keeps agent_sdk null (last-used mode). */
export const LAST_USED_AGENT_SDK = 'last_used';

export function isLastUsedAgentDefaults(defaults) {
  const parsed = parseAgentSessionDefaultsJson(defaults);
  return parsed.agent_sdk == null;
}

export function withLastUsedFlag(defaults) {
  const parsed = parseAgentSessionDefaultsJson(defaults);
  return {
    ...parsed,
    use_last_used: isLastUsedAgentDefaults(parsed),
  };
}

function coerceSdk(value) {
  if (value === 'claude' || value === 'cursor') return value;
  return null;
}

/** @returns {Array<{ id: string, value: string }> | null} */
export function coerceModelParams(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const id = row.id != null ? String(row.id).trim() : '';
    const val = row.value != null ? String(row.value) : '';
    if (!id) continue;
    out.push({ id, value: val });
  }
  return out.length ? out : null;
}

export function parseAgentSessionDefaultsJson(raw) {
  if (!raw) return { ...EMPTY_AGENT_SESSION_DEFAULTS };
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...EMPTY_AGENT_SESSION_DEFAULTS };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...EMPTY_AGENT_SESSION_DEFAULTS };
  }
  const model =
    parsed.model == null || parsed.model === '' ? null : String(parsed.model).trim() || null;
  let model_params = coerceModelParams(parsed.model_params);
  if (!model_params && parsed.variant_index != null && model) {
    // Legacy stored variant_index only — params resolved at session create time when possible.
    model_params = null;
  }
  return {
    agent_sdk: coerceSdk(parsed.agent_sdk),
    model,
    model_params,
  };
}

export function stringifyAgentSessionDefaults(defaults) {
  return JSON.stringify(parseAgentSessionDefaultsJson(defaults));
}

/** Partial patch for stored defaults (undefined = leave unchanged). */
export function mergeAgentSessionDefaults(existing, patch) {
  const base = parseAgentSessionDefaultsJson(existing);
  if (!patch || typeof patch !== 'object') return base;
  const out = { ...base };
  if (patch.agent_sdk !== undefined) out.agent_sdk = coerceSdk(patch.agent_sdk);
  if (patch.model !== undefined) {
    out.model =
      patch.model == null || patch.model === '' ? null : String(patch.model).trim() || null;
  }
  if (patch.model_params !== undefined) {
    out.model_params = coerceModelParams(patch.model_params);
  }
  return out;
}

/**
 * Merge MCP CreateSession explicit args with stored account defaults.
 * When defaults are in last-used mode, pass `lastUsed` from the user's latest session.
 * Explicit values (including `undefined` meaning omitted) win over defaults.
 */
export function resolveCreateSessionAgentFields(explicit, storedDefaults, lastUsed = null) {
  const defaults = parseAgentSessionDefaultsJson(storedDefaults);
  const useLastUsed = isLastUsedAgentDefaults(defaults);
  const fixed = !useLastUsed;

  const agent_sdk =
    explicit.agent_sdk !== undefined && explicit.agent_sdk !== null
      ? explicit.agent_sdk
      : fixed && defaults.agent_sdk
        ? defaults.agent_sdk
        : useLastUsed && lastUsed?.agent_sdk
          ? lastUsed.agent_sdk
          : 'claude';

  let model =
    explicit.model !== undefined && explicit.model !== null && explicit.model !== ''
      ? explicit.model
      : undefined;
  if (model === undefined && fixed && defaults.model && defaults.agent_sdk === agent_sdk) {
    model = defaults.model;
  } else if (model === undefined && useLastUsed && lastUsed?.model) {
    model = lastUsed.model;
  }

  let model_params;
  if (explicit.model_params !== undefined) {
    model_params = coerceModelParams(explicit.model_params);
  } else if (
    fixed &&
    defaults.model_params &&
    agent_sdk === 'cursor' &&
    defaults.agent_sdk === 'cursor'
  ) {
    model_params = defaults.model_params;
  } else if (useLastUsed && agent_sdk === 'cursor' && lastUsed?.model_params?.length) {
    model_params = lastUsed.model_params;
  }

  const variant_index =
    explicit.variant_index !== undefined && explicit.variant_index !== null
      ? explicit.variant_index
      : undefined;

  return { agent_sdk, model, model_params, variant_index };
}
