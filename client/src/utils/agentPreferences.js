export const DEFAULT_CURSOR_MODEL_PREFS = {
  cursor_fast: 'default',
  cursor_effort: 'default',
};

const FAST_VALUES = new Set(['default', 'yes', 'no']);
const EFFORT_VALUES = new Set(['default', 'low', 'medium', 'high', 'xhigh']);

export function normalizeCursorModelPrefs(raw) {
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
    cursor_fast: FAST_VALUES.has(parsed.cursor_fast)
      ? parsed.cursor_fast
      : DEFAULT_CURSOR_MODEL_PREFS.cursor_fast,
    cursor_effort: EFFORT_VALUES.has(parsed.cursor_effort)
      ? parsed.cursor_effort
      : DEFAULT_CURSOR_MODEL_PREFS.cursor_effort,
  };
}
