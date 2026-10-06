/** Text form agents see for a diff line reference (Cursor / Claude). */
export function fileReferenceAgentText({ path, line, short_sha, change }) {
  let text = `@${path}:${line}`;
  if (short_sha?.trim()) text += ` commit: ${short_sha.trim()}`;
  if (change === 'added' || change === 'removed') text += ` change: ${change}`;
  return text;
}

export function createFileReferenceBlock(path, line, { short_sha, change } = {}) {
  const n = Number(line);
  if (!path?.trim() || !Number.isFinite(n) || n < 1) {
    throw new Error('file_reference requires path and a positive line number');
  }
  const block = { type: 'file_reference', path: path.trim(), line: n };
  if (short_sha?.trim()) block.short_sha = short_sha.trim();
  if (change === 'added' || change === 'removed') block.change = change;
  return block;
}

/** Plain text for copy buttons and simple display. */
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

/** Build user content from a diff-line composer draft (`@path:line` plus optional note). */
export function contentBlocksFromLineDraft(text, ref) {
  const block = createFileReferenceBlock(ref.path, ref.line, {
    short_sha: ref.short_sha,
    change: ref.change,
  });
  const refText = fileReferenceAgentText(block);
  const trimmed = (text ?? '').trim();
  if (!trimmed || trimmed === refText) return [block];
  let rest = trimmed;
  if (trimmed.startsWith(refText)) {
    rest = trimmed.slice(refText.length).replace(/^\s+/, '');
  }
  if (!rest) return [block];
  return [block, { type: 'text', text: rest }];
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

const USER_BLOCK_TYPES = new Set(['text', 'file_reference']);

/** Collapse legacy SDK user content arrays for storage (string or block list). */
export function normalizeLegacyUserContentBlocks(legacyContent) {
  if (!Array.isArray(legacyContent)) return null;
  if (legacyContent.some((b) => b.type === 'tool_result')) {
    return { legacy_tool_result_carrier: true };
  }
  const hasFileRef = legacyContent.some((b) => b.type === 'file_reference');
  if (!hasFileRef) {
    return {
      content: legacyContent
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n\n'),
    };
  }
  return {
    content: legacyContent.filter((b) => USER_BLOCK_TYPES.has(b.type)),
  };
}
