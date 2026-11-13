import { useCallback, useEffect, useRef, useState } from 'react';
import { boundScopeLoading, boundScopeValue } from '../utils/boundScope.js';
import { useScopeRequest } from './useScopeRequest.js';

/**
 * Session-scoped async resource. Until a result for `scopeKey` lands, `data` is
 * `empty` and `loading` is true — so the first paint after a key change never
 * shows the previous scope. In-flight results from an older key are ignored.
 *
 * Pass `scopeKey` as `''` when inactive. `revision` (or `reload()`) re-runs
 * `load` for the current key. `patch` updates data in place (live appends).
 *
 * Contract for callers:
 * - `empty` must be a referentially stable value (module constant, primitive,
 *   `null`, or `undefined`). It is a dependency of the fetch effect, so a new
 *   `[]`/`{}` identity on every render would restart the fetch each render and
 *   loop forever.
 * - Errors thrown by `load` are swallowed and converted to `empty` (with
 *   `loading` resolved false). To show error UX, catch inside `load` and call
 *   e.g. `toastFeathersError` there.
 * - Gate `patch` with `isKeyCurrent(<key the patch belongs to>)` so live
 *   appends for an old scope cannot land into a new scope (see task logs).
 *
 * @template T
 * @param {string} scopeKey
 * @param {{
 *   empty: T,
 *   enabled?: boolean,
 *   load?: () => Promise<T>,
 *   revision?: number | string,
 * }} [options]
 */
export function useScopedResource(scopeKey, { empty, enabled = true, load, revision = 0 } = {}) {
  const { begin, isKeyCurrent } = useScopeRequest(scopeKey);
  const [data, setData] = useState(empty);
  const [loadedKey, setLoadedKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const reload = useCallback(() => {
    setReloadTick((n) => n + 1);
  }, []);

  const patch = useCallback((updater) => {
    setData((prev) => (typeof updater === 'function' ? updater(prev) : updater));
  }, []);

  useEffect(() => {
    if (!scopeKey) {
      begin('');
      setData(empty);
      setLoadedKey('');
      setLoading(false);
      return undefined;
    }
    if (!enabled || !loadRef.current) {
      setLoading(false);
      return undefined;
    }

    const key = scopeKey;
    const isCurrent = begin(key);
    let cancelled = false;
    setLoading(true);

    Promise.resolve()
      .then(() => loadRef.current())
      .then((next) => {
        if (cancelled || !isCurrent()) return;
        setData(next);
        setLoadedKey(key);
      })
      .catch(() => {
        if (cancelled || !isCurrent()) return;
        setData(empty);
        setLoadedKey(key);
      })
      .finally(() => {
        if (!cancelled && isCurrent()) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [scopeKey, enabled, revision, reloadTick, begin, empty]);

  return {
    data: boundScopeValue(scopeKey, loadedKey, data, empty),
    // `enabled` matters here: for a non-empty but unbound key
    // boundScopeLoading would stay true even while no fetch can run. With
    // `enabled` false there is no in-flight load, so loading must be false.
    loading: enabled && boundScopeLoading(scopeKey, loadedKey, loading),
    reload,
    patch,
    isKeyCurrent,
  };
}
