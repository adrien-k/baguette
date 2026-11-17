import { useCallback, useMemo } from 'react';
import { compileFileFilters } from '../utils/fileFilters.js';
import { usePersistentState } from './usePersistentState.js';

const STORAGE_KEY = 'session-file-filters';

/**
 * Shared regex include/exclude filters for changed-file paths. Owned by
 * `Session` so the files panel list and the diff view filter in sync.
 * Patterns compile per keystroke; an invalid pattern keeps filtering off for
 * that field (see `compiled.includeError` / `compiled.excludeError`).
 * Include/exclude strings persist in localStorage for the device.
 */
export function useSessionFileFilters() {
  const { useState: makeField, clear: clearPersisted } = usePersistentState(STORAGE_KEY);
  const [includePattern, setIncludePattern] = makeField('includePattern', '');
  const [excludePattern, setExcludePattern] = makeField('excludePattern', '');

  const compiled = useMemo(
    () => compileFileFilters(includePattern, excludePattern),
    [includePattern, excludePattern]
  );

  const clear = useCallback(() => {
    clearPersisted();
  }, [clearPersisted]);

  return { includePattern, setIncludePattern, excludePattern, setExcludePattern, clear, compiled };
}
