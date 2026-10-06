/**
 * Normalize a user payload for storage.
 *
 * Accepts both the canonical shape and the legacy SDK envelope
 * (`{ message: { content: [...] } }`), folding the latter's text blocks into a
 * plain string. Rows whose content is only `tool_result` blocks are flagged
 * `legacy_tool_result_carrier` so `parseMessageRow` can hide them.
 *
 * @param {object} parsed
 */
export function normalizeUserPayloadForStorage(parsed) {
  if (parsed?.type === 'user' && (parsed.source === 'mcp' || parsed.subtype === 'mcp')) {
    if (typeof parsed.content === 'string') {
      return { type: 'user', source: 'mcp', content: parsed.content, subtype: 'mcp' };
    }
    const legacyContent = parsed.message?.content;
    let content = '';
    if (typeof legacyContent === 'string') content = legacyContent;
    else if (Array.isArray(legacyContent)) {
      content = legacyContent
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n\n');
    }
    return { type: 'user', source: 'mcp', content, subtype: 'mcp' };
  }
  if (parsed?.type === 'user' && typeof parsed.content === 'string') return parsed;
  if (parsed?.type !== 'user') return parsed;

  const legacyContent = parsed.message?.content;
  let content = '';
  if (typeof legacyContent === 'string') content = legacyContent;
  else if (Array.isArray(legacyContent)) {
    if (legacyContent.some((b) => b.type === 'tool_result')) {
      return { type: 'user', legacy_tool_result_carrier: true, content: '' };
    }
    content = legacyContent
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n\n');
  }

  const out = { type: 'user', content };
  if (parsed.source === 'baguette' || parsed.subtype === 'baguette') {
    out.source = 'baguette';
    if (parsed.title) out.title = parsed.title;
    out.subtype = 'baguette';
  }
  return out;
}
