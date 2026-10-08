/** Default number of messages per page for the GetSessionMessages MCP tool. */
export const MCP_MESSAGES_PAGE_SIZE = 50;

/**
 * Strip thinking blocks from an assistant message payload.
 * Returns { messageJson, thinkingOnly }: messageJson is the (possibly rewritten) JSON string
 * and thinkingOnly is true when the row contained nothing but thinking blocks (drop it).
 */
function stripThinkingBlocks(messageJson) {
  let payload;
  try {
    payload = JSON.parse(messageJson);
  } catch {
    return { messageJson, thinkingOnly: false };
  }
  if (payload?.type !== 'assistant' || !Array.isArray(payload.blocks)) {
    return { messageJson, thinkingOnly: false };
  }
  const kept = payload.blocks.filter((block) => block?.type !== 'thinking');
  if (kept.length === payload.blocks.length) return { messageJson, thinkingOnly: false };
  return {
    messageJson: JSON.stringify({ ...payload, blocks: kept }),
    thinkingOnly: kept.length === 0,
  };
}

/**
 * Build one page of session messages for the GetSessionMessages MCP tool.
 * Thinking blocks are stripped from assistant rows; thinking-only rows are skipped entirely.
 * The caller fetches up to one extra row to know whether more pages exist (hasMoreRows).
 * Returns { messages, nextMessageId, hasMore }: nextMessageId is the id to pass as
 * afterMessage on the next page, or null when there are no more rows.
 */
export function packSessionMessagesForMcp(rows, { hasMoreRows = false } = {}) {
  const messages = [];

  for (const row of rows) {
    const { messageJson, thinkingOnly } = stripThinkingBlocks(row.message_json ?? '');
    if (thinkingOnly) continue;

    messages.push({
      id: row.id,
      type: row.type,
      subtype: row.subtype ?? null,
      created_at: row.created_at,
      message_json: messageJson,
    });
  }

  const lastRow = rows.length ? rows[rows.length - 1] : null;
  const nextMessageId = hasMoreRows && lastRow ? lastRow.id : null;

  return {
    messages,
    nextMessageId,
    hasMore: nextMessageId != null,
  };
}
