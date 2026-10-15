/** Default collapsed preview length for long markdown in chat (assistant text, PrUpsert body, etc.). */
export const CHAT_CONTENT_PREVIEW_LINES = 8;

function isFenceLine(line) {
  return /^```/.test(String(line).trim());
}

/**
 * If `end` falls inside an open fenced code block, extend through its closing fence.
 * Avoids "Read more" splitting mermaid charts and other fenced blocks in half.
 *
 * @param {string[]} lines
 * @param {number} end exclusive line index for the preview slice
 * @param {number} lineCount
 */
function extendPreviewEndPastOpenFence(lines, end, lineCount) {
  let inFence = false;
  for (let i = 0; i < end; i++) {
    if (isFenceLine(lines[i])) {
      inFence = !inFence;
    }
  }
  if (!inFence) {
    return end;
  }
  for (let i = end; i < lineCount; i++) {
    if (isFenceLine(lines[i])) {
      return i + 1;
    }
  }
  return lineCount;
}

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
  const end = extendPreviewEndPastOpenFence(lines, maxLines, lineCount);
  return {
    preview: lines.slice(0, end).join('\n'),
    remaining: lineCount - end,
    lineCount,
  };
}
