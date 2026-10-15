/**
 * User messages injected by a scheduled / tied session loop (not composer-typed).
 */

/** @param {string} content @param {{ title?: string }} [opts] */
export function buildLoopUserMessagePayload(content, { title } = {}) {
  const payload = {
    type: 'user',
    source: 'loop',
    subtype: 'loop',
    content: String(content),
  };
  if (title != null && String(title).trim() !== '') {
    payload.title = String(title).trim();
  }
  return payload;
}

/** @param {string} content @param {{ title?: string }} [opts] */
export function buildLoopUserMessageJson(content, opts) {
  return JSON.stringify(buildLoopUserMessagePayload(content, opts));
}

/** `session_messages.subtype` when `message_json` is a loop user payload. */
export function loopUserRowSubtypeFromMessageJson(messageJson) {
  try {
    const parsed = JSON.parse(messageJson || '{}');
    if (parsed?.type === 'user' && (parsed.source === 'loop' || parsed.subtype === 'loop')) {
      return 'loop';
    }
  } catch {
    /* ignore */
  }
  return null;
}
