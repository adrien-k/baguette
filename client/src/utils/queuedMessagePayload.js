/**
 * Read/write helpers for the `queued_messages.message_json` payload.
 *
 * Two shapes reach this component:
 * - Typed (rows queued via `messages.create` while the agent is mid-turn): the server's
 *   `normalizeUserPayloadForStorage` has already rewritten the legacy envelope to
 *   `{ type: 'user', content: '<text>' }`.
 * - Legacy (rows from `queued-messages.schedule`): the client envelope
 *   `{ type: 'user', message: { role: 'user', content } }`, where content is a string or
 *   a block array that may still carry attachments.
 *
 * Both must render and edit correctly, so every read/write goes through here.
 */

function parsePayload(messageJson) {
  try {
    const parsed = JSON.parse(messageJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Content blocks of the payload, whether it uses the typed or the legacy envelope.
 * @returns {Array<Record<string, unknown>>}
 */
function contentBlocks(payload) {
  if (!payload) return [];
  const content =
    typeof payload.content === 'string' || Array.isArray(payload.content)
      ? payload.content
      : payload.message?.content;
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (Array.isArray(content)) return content;
  return [];
}

/** Content blocks for display (text, file_reference, attachments, …). */
export function readQueuedMessageBlocks(messageJson) {
  return contentBlocks(parsePayload(messageJson));
}

/** Plain text a queued message shows, and the edit form seeds itself from. */
export function readQueuedMessageText(messageJson) {
  return contentBlocks(parsePayload(messageJson))
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n\n');
}

/** Whether the message carries a non-text block (image, document, file_reference…). */
export function queuedMessageHasAttachments(messageJson) {
  return contentBlocks(parsePayload(messageJson)).some((b) => b?.type && b.type !== 'text');
}

/**
 * Rewrite the message text, preserving the payload's shape and any non-text blocks.
 * Text blocks collapse to a single leading block so repeated edits don't accumulate them.
 */
export function rebuildQueuedMessageJson(messageJson, newText) {
  const payload = parsePayload(messageJson);
  if (!payload) return messageJson;

  const blocks = contentBlocks(payload);
  const nonTextBlocks = blocks.filter((b) => b?.type !== 'text');
  const nextBlocks = newText ? [{ type: 'text', text: newText }, ...nonTextBlocks] : nonTextBlocks;

  // Typed envelope stays typed; only rewrite the legacy envelope when it used blocks.
  if (payload.message === undefined) {
    return JSON.stringify({ ...payload, content: newText });
  }
  const legacyContentWasString = typeof payload.message?.content === 'string';
  const content = legacyContentWasString && nextBlocks.length === 1 ? newText : nextBlocks;
  return JSON.stringify({
    ...payload,
    message: { ...payload.message, content },
  });
}
