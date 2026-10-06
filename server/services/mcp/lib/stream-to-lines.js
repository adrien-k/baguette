/** Split stream text into lines for JSON arrays (drops trailing empty segment from final newline). */
export function streamToLines(text) {
  if (text === '' || text == null) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
