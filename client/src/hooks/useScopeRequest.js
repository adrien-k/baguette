import { useCallback, useEffect, useRef } from 'react';

/**
 * Ignore async results that belong to a previous scope (or an older fetch of
 * the same scope). Call `begin(key)` when starting a request; the returned
 * predicate is true only for the latest request of the current key.
 */
export function useScopeRequest(scopeKey) {
  const keyRef = useRef(scopeKey);
  const genRef = useRef(0);

  useEffect(() => {
    keyRef.current = scopeKey;
  }, [scopeKey]);

  const begin = useCallback((key) => {
    const requestKey = key ?? keyRef.current;
    keyRef.current = requestKey;
    const gen = ++genRef.current;
    return () => keyRef.current === requestKey && genRef.current === gen;
  }, []);

  const isKeyCurrent = useCallback((key) => keyRef.current === key, []);

  return { begin, isKeyCurrent, keyRef };
}
