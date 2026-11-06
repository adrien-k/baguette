/**
 * Session-scoped hook data must not leak across id changes.
 *
 * React keeps the previous `useState` until effects run, and in-flight fetches
 * can resolve after the user has already switched. Pair each payload with the
 * scope key it was loaded for, then use these helpers at the hook return
 * boundary so the first paint after a switch is empty/loading — and a stale
 * response cannot reappear.
 */

export function scopeKeyOf(...parts) {
  return parts.map((part) => (part == null || part === '' ? '' : String(part))).join('\0');
}

export function sameScopeId(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return String(a) === String(b);
}

export function isBoundScope(requestedKey, loadedKey) {
  return requestedKey != null && requestedKey !== '' && requestedKey === loadedKey;
}

/** True while this scope has no matching loaded payload yet, or an in-flight load. */
export function boundScopeLoading(requestedKey, loadedKey, loading = false) {
  if (requestedKey == null || requestedKey === '') return false;
  return loadedKey !== requestedKey || Boolean(loading);
}

export function boundScopeValue(requestedKey, loadedKey, value, empty) {
  return isBoundScope(requestedKey, loadedKey) ? value : empty;
}

export function rowsForSession(rows, sessionId, extraMatch) {
  if (sessionId == null || !Array.isArray(rows)) return [];
  return rows.filter((row) => {
    if (!sameScopeId(row?.session_id, sessionId)) return false;
    return extraMatch ? extraMatch(row) : true;
  });
}
