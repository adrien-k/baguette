/** Default collapsed preview length for long markdown in chat (assistant text, PrUpsert body, etc.). */
export const CHAT_CONTENT_PREVIEW_LINES = 8;

/**
 * @param {string} text
 * @param {number} [maxLines]
 * @returns {{ preview: string; remaining: number; lineCount: number }}
 */
export function splitPreviewLines(text, maxLines = CHAT_CONTENT_PREVIEW_LINES) {
  const lines = (text ?? '').split('\n');
  const lineCount = lines.length;
  if (lineCount <= maxLines) {
    return { preview: text ?? '', remaining: 0, lineCount };
  }
  return {
    preview: lines.slice(0, maxLines).join('\n'),
    remaining: lineCount - maxLines,
    lineCount,
  };
}
