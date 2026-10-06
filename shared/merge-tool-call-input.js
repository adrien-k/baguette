/** @param {Record<string, unknown> | null | undefined} input */
export function hasNonemptyToolInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && value.trim() !== '') return true;
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0
    ) {
      return true;
    }
    if (value != null && typeof value !== 'string' && typeof value !== 'object') return true;
  }
  return false;
}

/**
 * Merge streaming / duplicate tool_start inputs without letting empty strings
 * overwrite values already received (e.g. Bash `command` filled in on a later frame).
 * @param {Record<string, unknown> | null | undefined} prev
 * @param {Record<string, unknown>} next
 * @returns {Record<string, unknown>}
 */
export function mergeToolCallInput(prev, next) {
  const a = prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...prev } : {};
  const b = next && typeof next === 'object' && !Array.isArray(next) ? next : {};
  const out = { ...a, ...b };

  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const nv = b[key];
    const pv = a[key];
    if (typeof nv === 'string' && nv.trim() === '' && typeof pv === 'string' && pv.trim()) {
      out[key] = pv;
    }
  }

  if (b.input && typeof b.input === 'object' && !Array.isArray(b.input)) {
    const prevInput =
      a.input && typeof a.input === 'object' && !Array.isArray(a.input) ? a.input : {};
    out.input = mergeToolCallInput(prevInput, b.input);
  } else if (a.input && b.input === undefined) {
    out.input = a.input;
  }

  return out;
}

/**
 * Reconstruct raw tool input from a persisted tool_call payload for merging.
 * @param {{ kind?: string; args?: Record<string, unknown> }} payload
 */
export function toolInputFromPayload(payload) {
  const args = payload?.args && typeof payload.args === 'object' ? { ...payload.args } : {};
  if (payload?.kind === 'generic' && args.input && typeof args.input === 'object') {
    return mergeToolCallInput(args.input, args);
  }
  return args;
}
