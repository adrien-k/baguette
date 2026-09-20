export const DEFAULT_CURSOR_MODEL_PREFS = {
  cursor_fast: 'default',
  cursor_effort: 'default',
};

const FAST_VALUES = new Set(['default', 'yes', 'no']);
const EFFORT_VALUES = new Set(['default', 'low', 'medium', 'high', 'xhigh']);

function coerceFast(value) {
  return FAST_VALUES.has(value) ? value : DEFAULT_CURSOR_MODEL_PREFS.cursor_fast;
}

function coerceEffort(value) {
  return EFFORT_VALUES.has(value) ? value : DEFAULT_CURSOR_MODEL_PREFS.cursor_effort;
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
    cursor_fast: coerceFast(parsed.cursor_fast),
    cursor_effort: coerceEffort(parsed.cursor_effort),
  };
}

export function mergeCursorModelPrefs(existing, patch) {
  const base = parseCursorModelPrefsJson(existing);
  const next = parseCursorModelPrefsJson(patch);
  return {
    cursor_fast: patch?.cursor_fast !== undefined ? next.cursor_fast : base.cursor_fast,
    cursor_effort: patch?.cursor_effort !== undefined ? next.cursor_effort : base.cursor_effort,
  };
}

export function stringifyCursorModelPrefs(prefs) {
  return JSON.stringify(parseCursorModelPrefsJson(prefs));
}
