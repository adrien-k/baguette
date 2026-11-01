/**
 * Normalize Claude Agent SDK tool_result `content` for persistence and UI.
 * Content may be a string or an array of { type, text } blocks.
 */

/**
 * @param {unknown} raw
 * @param {{ isError?: boolean }} [opts]
 * @returns {{ content: string; isError: boolean }}
 */
export function formatClaudeToolResult(raw, opts = {}) {
  const isError = Boolean(opts.isError);
  if (raw === undefined || raw === null) {
    return isError
      ? { content: 'Tool call failed', isError: true }
      : { content: '', isError: false };
  }

  if (typeof raw === 'string') {
    if (!raw.trim()) {
      return isError
        ? { content: 'Tool call failed', isError: true }
        : { content: '', isError: false };
    }
    return { content: raw, isError };
  }

  if (Array.isArray(raw)) {
    const text = raw
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        if (block.type === 'text' && typeof block.text === 'string') return block.text;
        if (typeof block.text === 'string') return block.text;
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
    if (text) return { content: text, isError };
    if (isError) return { content: 'Tool call failed', isError: true };
    return { content: '', isError: false };
  }

  if (typeof raw === 'object') {
    if (raw.type === 'text' && typeof raw.text === 'string') {
      return { content: raw.text, isError };
    }
    try {
      return { content: JSON.stringify(raw, null, 2), isError };
    } catch {
      return { content: String(raw), isError };
    }
  }

  return { content: String(raw), isError };
}
