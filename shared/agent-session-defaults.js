const EMPTY_AGENT_SESSION_DEFAULTS = {
  agent_sdk: null,
  model: null,
  model_params: null,
};

/** UI / API sentinel — stored JSON keeps agent_sdk null (last-used mode). */
const LAST_USED_AGENT_SDK = 'last_used';

function isLastUsedAgentDefaults(defaults) {
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
  if (value == null || value === '' || value === LAST_USED_AGENT_SDK) return null;
  if (typeof value !== 'string') return null;
  return value;
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
  for (const item of value) {
    if (!item || typeof item.id !== 'string' || typeof item.value !== 'string') return null;
    out.push({ id: item.id, value: item.value });
  }
  return out;
}

/** SQLite TEXT column: accept API arrays/objects and store JSON string. */
export function stringifyModelParamsForStorage(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value;
  const coerced = coerceModelParams(value);
  if (coerced?.length) return JSON.stringify(coerced);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const single = coerceModelParams([value]);
    if (single?.length) return JSON.stringify(single);
  }
  return null;
}

export function parseAgentSessionDefaultsJson(raw) {
  if (raw == null || raw === '') return { ...EMPTY_AGENT_SESSION_DEFAULTS };
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...EMPTY_AGENT_SESSION_DEFAULTS };
    }
  }
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_AGENT_SESSION_DEFAULTS };
  return {
    agent_sdk: coerceSdk(parsed.agent_sdk),
    model: parsed.model ?? null,
    model_params: coerceModelParams(parsed.model_params),
  };
}

/**
 * Merge MCP CreateSession explicit args with stored account defaults.
 * When defaults are in last-used mode, pass `lastUsed` from the user's latest session.
 * Explicit values (including `undefined` meaning omitted) win over defaults.
 */
export function resolveCreateSessionAgentFields(
  explicit,
  storedDefaults,
  lastUsed = null,
  defaultSdk = null
) {
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
          : defaultSdk;

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
    agent_sdk === defaults.agent_sdk &&
    (agent_sdk === 'cursor' || agent_sdk === 'claude' || agent_sdk === 'pi')
  ) {
    model_params = defaults.model_params;
  } else if (
    useLastUsed &&
    (agent_sdk === 'cursor' || agent_sdk === 'claude' || agent_sdk === 'pi') &&
    lastUsed?.agent_sdk === agent_sdk &&
    lastUsed?.model_params?.length
  ) {
    model_params = lastUsed.model_params;
  }

  const variant_index =
    explicit.variant_index !== undefined && explicit.variant_index !== null
      ? explicit.variant_index
      : undefined;

  return { agent_sdk, model, model_params, variant_index };
}
