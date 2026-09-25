/** Join user- and repo-level prompt extensions (both apply when set). */
export function combinePromptExtensions(...parts) {
  return parts
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}
