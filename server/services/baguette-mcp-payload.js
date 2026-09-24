import { sliceByteRange } from './mcp-pagination.js';

/** Max UTF-8 bytes for MCP tool JSON payloads listing session messages. */
export const MCP_TOOL_PAYLOAD_MAX_BYTES = 5000;

export function jsonUtf8ByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

const TRUNCATED_HINT =
  'Message body was truncated in this list. Call GetSessionMessage with messageId (and optional startByte/endByte) to read the rest. Use afterMessage to fetch the next page.';

function fitsPayload(messages, entry, afterMessage) {
  return (
    jsonUtf8ByteLength({ messages: [...messages, entry], afterMessage }) <=
    MCP_TOOL_PAYLOAD_MAX_BYTES
  );
}

function shrinkMessageEntry(messages, row, afterMessage) {
  const full = row.message_json ?? '';
  const totalBytes = Buffer.byteLength(full, 'utf8');
  if (totalBytes === 0) {
    const entry = {
      id: row.id,
      type: row.type,
      subtype: row.subtype ?? null,
      created_at: row.created_at,
      message_json: '',
      truncated: false,
    };
    return fitsPayload(messages, entry, afterMessage) ? entry : null;
  }

  let end = Math.min(totalBytes - 1, MCP_TOOL_PAYLOAD_MAX_BYTES - 400);
  while (end >= 0) {
    const slice = sliceByteRange(full, { startByte: 0, endByte: end });
    const entry = {
      id: row.id,
      type: row.type,
      subtype: row.subtype ?? null,
      created_at: row.created_at,
      message_json: slice.log,
      truncated: slice.endByte < totalBytes - 1,
      totalBytes,
      startByte: slice.startByte,
      endByte: slice.endByte,
      hint: TRUNCATED_HINT,
    };
    if (fitsPayload(messages, entry, afterMessage)) return entry;
    end = Math.floor(end / 2) - 1;
  }
  return null;
}

/**
 * Fit message rows into a JSON payload under maxBytes. Truncates the last message if needed.
 */
export function packSessionMessagesForMcp(rows, { afterMessage = null } = {}) {
  const messages = [];
  let truncated = false;

  for (const row of rows) {
    const base = {
      id: row.id,
      type: row.type,
      subtype: row.subtype ?? null,
      created_at: row.created_at,
      message_json: row.message_json,
    };

    if (fitsPayload(messages, base, afterMessage)) {
      messages.push(base);
      continue;
    }

    const shrunk = shrinkMessageEntry(messages, row, afterMessage);
    if (shrunk) {
      messages.push(shrunk);
      truncated = true;
      break;
    }
    truncated = true;
    break;
  }

  const lastId = messages.length ? messages[messages.length - 1].id : afterMessage;
  const hasMore =
    truncated || (messages.length > 0 && rows.some((r) => r.id > messages[messages.length - 1].id));

  return {
    messages,
    nextAfterMessage: lastId,
    hasMore,
    ...(truncated || hasMore ? { hint: TRUNCATED_HINT } : {}),
  };
}
