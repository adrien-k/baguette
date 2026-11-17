import { useCallback, useMemo, useState } from 'react';
import { compileFileFilters } from '../utils/fileFilters.js';

/**
 * Shared regex include/exclude filters for changed-file paths. Owned by
 * `Session` so the files panel list and the diff view filter in sync.
 * Patterns compile per keystroke; an invalid pattern keeps filtering off for
 * that field (see `compiled.includeError` / `compiled.excludeError`).
 */
export function useSessionFileFilters() {
  const [includePattern, setIncludePattern] = useState('');
  const [excludePattern, setExcludePattern] = useState('');

  const compiled = useMemo(
    () => compileFileFilters(includePattern, excludePattern),
    [includePattern, excludePattern]
  );

  const clear = useCallback(() => {
    setIncludePattern('');
    setExcludePattern('');
  }, []);

  return { includePattern, setIncludePattern, excludePattern, setExcludePattern, clear, compiled };
}
