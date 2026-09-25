/** Text form agents see for a diff line reference (Cursor / Claude). */
export function fileReferenceAgentText({ path, line }) {
  return `@${path}:${line}`;
}

export function createFileReferenceBlock(path, line) {
  const n = Number(line);
  if (!path?.trim() || !Number.isFinite(n) || n < 1) {
    throw new Error('file_reference requires path and a positive line number');
  }
  return { type: 'file_reference', path: path.trim(), line: n };
}

/** Flatten user content blocks to plain text for Cursor `agent.send`. */
export function expandUserContentForAgent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const b of content) {
    if (b.type === 'text' && b.text) parts.push(b.text);
    else if (b.type === 'file_reference') parts.push(fileReferenceAgentText(b));
  }
  return parts.join('\n\n');
}

/** Replace file_reference blocks with text blocks for the Claude agent SDK. */
export function normalizeUserContentBlocks(content) {
  if (!Array.isArray(content)) return content;
  if (!content.some((b) => b.type === 'file_reference')) return content;
  return content.flatMap((b) => {
    if (b.type === 'file_reference') {
      return [{ type: 'text', text: fileReferenceAgentText(b) }];
    }
    return [b];
  });
}

export function normalizeUserMessageForAgentSdk(parsed) {
  const content = parsed?.message?.content;
  if (!Array.isArray(content) || !content.some((b) => b.type === 'file_reference')) {
    return parsed;
  }
  return {
    ...parsed,
    message: {
      ...parsed.message,
      content: normalizeUserContentBlocks(content),
    },
  };
}
