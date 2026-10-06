import { useState, useCallback, useEffect, useRef } from 'react';

function readFromStorage(key) {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}

export function usePersistentState(storageKey) {
  const [store, setStore] = useState(() => readFromStorage(storageKey));
  const prevKeyRef = useRef(storageKey);
  // persistWhen gates by field key, so any write persists a snapshot that respects all gates of
  // its storage key, not just the gate of the field being written. Gates are scoped per storage
  // key and re-registered by makeField on every render, so a storage-key change never inherits
  // another key's stale gate set.
  const gatesRef = useRef({});

  useEffect(() => {
    if (storageKey !== prevKeyRef.current) {
      prevKeyRef.current = storageKey;
      setStore(readFromStorage(storageKey));
    }
  }, [storageKey]);

  // Returns [value, setter] — like useState but backed by localStorage under storageKey.fieldKey.
  // `options.persistWhen(store)` gates persistence: while it returns false the value still works
  // in memory, but stays out of the persisted snapshot.
  const makeField = (fieldKey, defaultValue, options = {}) => {
    const { persistWhen } = options;
    if (!gatesRef.current[storageKey]) gatesRef.current[storageKey] = {};
    const keyGates = gatesRef.current[storageKey];
    if (persistWhen) keyGates[fieldKey] = persistWhen;
    else delete keyGates[fieldKey];
    const value = fieldKey in store ? store[fieldKey] : defaultValue;
    const setValue = (newValue) => {
      setStore((prev) => {
        const resolved =
          typeof newValue === 'function' ? newValue(prev[fieldKey] ?? defaultValue) : newValue;
        const next = { ...prev, [fieldKey]: resolved };
        if (storageKey) {
          const gates = gatesRef.current[storageKey] ?? {};
          const persisted = Object.fromEntries(
            Object.entries(next).filter(([key]) => {
              const gate = gates[key];
              return !gate || gate(next);
            })
          );
          try {
            localStorage.setItem(storageKey, JSON.stringify(persisted));
          } catch {
            // ignore quota / private mode
          }
        }
        return next;
      });
    };
    return [value, setValue];
  };

  const clear = useCallback(() => {
    setStore({});
    if (storageKey) localStorage.removeItem(storageKey);
  }, [storageKey]);

  return { useState: makeField, clear, store };
}
