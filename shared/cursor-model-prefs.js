/** Composer / settings order for Cursor model params (auto-push is separate). */
export const CURSOR_PARAM_ORDER = [
  'fast',
  'thinking',
  'effort',
  'reasoning_effort',
  'reasoning',
  'context',
  'cyber',
];

export const PARAM_ID_TO_PREF_KEY = {
  fast: 'cursor_fast',
  thinking: 'cursor_thinking',
  effort: 'cursor_effort',
  reasoning_effort: 'cursor_effort',
  reasoning: 'cursor_reasoning',
  context: 'cursor_context',
  cyber: 'cursor_cyber',
};

export const DEFAULT_CURSOR_MODEL_PREFS = {
  cursor_fast: 'default',
  cursor_thinking: 'default',
  cursor_effort: 'default',
  cursor_reasoning: 'default',
  cursor_context: 'default',
  cursor_cyber: 'default',
};

const FAST_VALUES = new Set(['default', 'yes', 'no']);
const EFFORT_VALUES = new Set(['default', 'low', 'medium', 'high', 'xhigh', 'max']);
const REASONING_VALUES = new Set([
  'default',
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'extra-high',
  'max',
]);
const CONTEXT_VALUES = new Set(['default', '200k', '272k', '300k', '500k', '1m']);

function coerceYesNoPref(value, fallback) {
  return FAST_VALUES.has(value) ? value : fallback;
}

function coerceEffort(value) {
  return EFFORT_VALUES.has(value) ? value : DEFAULT_CURSOR_MODEL_PREFS.cursor_effort;
}

function coerceReasoning(value) {
  return REASONING_VALUES.has(value) ? value : DEFAULT_CURSOR_MODEL_PREFS.cursor_reasoning;
}

function coerceContext(value) {
  if (value === 'default') return 'default';
  if (CONTEXT_VALUES.has(value)) return value;
  if (typeof value === 'string' && /^\d+(\.\d+)?[km]?$/i.test(value.trim())) {
    return value.trim().toLowerCase();
  }
  return DEFAULT_CURSOR_MODEL_PREFS.cursor_context;
}

export function parseCursorModelPrefsJson(raw) {
  if (!raw) return { ...DEFAULT_CURSOR_MODEL_PREFS };
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_CURSOR_MODEL_PREFS };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...DEFAULT_CURSOR_MODEL_PREFS };
  }
  return {
    cursor_fast: coerceYesNoPref(parsed.cursor_fast, DEFAULT_CURSOR_MODEL_PREFS.cursor_fast),
    cursor_thinking: coerceYesNoPref(
      parsed.cursor_thinking,
      DEFAULT_CURSOR_MODEL_PREFS.cursor_thinking
    ),
    cursor_effort: coerceEffort(parsed.cursor_effort),
    cursor_reasoning: coerceReasoning(parsed.cursor_reasoning),
    cursor_context: coerceContext(parsed.cursor_context),
    cursor_cyber: coerceYesNoPref(parsed.cursor_cyber, DEFAULT_CURSOR_MODEL_PREFS.cursor_cyber),
  };
}

export function mergeCursorModelPrefs(existing, patch) {
  const base = parseCursorModelPrefsJson(existing);
  const next = parseCursorModelPrefsJson(patch);
  const out = { ...base };
  for (const key of Object.keys(DEFAULT_CURSOR_MODEL_PREFS)) {
    if (patch?.[key] !== undefined) out[key] = next[key];
  }
  return out;
}

export function stringifyCursorModelPrefs(prefs) {
  return JSON.stringify(parseCursorModelPrefsJson(prefs));
}

export function prefKeyForParamId(paramId) {
  return PARAM_ID_TO_PREF_KEY[paramId] ?? null;
}

/** @param {string} paramId @param {string} paramValue */
export function prefValueFromParamValue(paramId, paramValue) {
  if (paramId === 'fast' || paramId === 'thinking' || paramId === 'cyber') {
    if (paramValue === 'true') return 'yes';
    if (paramValue === 'false') return 'no';
    return 'default';
  }
  return paramValue;
}
