import { diffFileDisplayPath } from './paths.js';

/**
 * Compile one include/exclude regex string. Empty/whitespace patterns compile
 * to `regex: null` (filter off); invalid patterns keep the regex off and
 * surface `error` so the field can show an inline hint without breaking the
 * other field.
 */
function compilePattern(pattern) {
  const text = typeof pattern === 'string' ? pattern.trim() : '';
  if (!text) return { regex: null, error: null };
  try {
    return { regex: new RegExp(text), error: null };
  } catch (err) {
    return { regex: null, error: err.message };
  }
}

/**
 * Compile include/exclude regex filter strings for changed-file paths.
 * Each pattern is compiled independently so one invalid pattern does not
 * disable the other. `active` is true when at least one effective regex exists.
 */
export function compileFileFilters(includePattern, excludePattern) {
  const include = compilePattern(includePattern);
  const exclude = compilePattern(excludePattern);
  return {
    include: include.regex,
    exclude: exclude.regex,
    includeError: include.error,
    excludeError: exclude.error,
    active: Boolean(include.regex || exclude.regex),
  };
}

/**
 * A path passes when it matches every active include regex and no active
 * exclude regex. Paths match against the full repo-relative display path.
 */
export function fileMatchesFilters(path, filters) {
  if (!filters) return true;
  if (filters.include && !filters.include.test(path)) return false;
  if (filters.exclude && filters.exclude.test(path)) return false;
  return true;
}

/** Filter parsed diff file records (oldPath/newPath shape) by their display path. */
export function filterDiffFiles(files, filters) {
  if (!filters?.active) return files;
  return files.filter((file) => fileMatchesFilters(diffFileDisplayPath(file), filters));
}
