/** Default number of messages per page for the GetAgentMessages MCP tool. */
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

const TOOL_ARGS_LIMIT = 400;
const TOOL_RESULT_LIMIT = 600;

const clipJson = (value, limit) => {
  if (value == null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
};

/** A tool call row without its bulk: tool, status, timing, shortened arguments and result. */
function compactToolCall(messageJson) {
  let payload;
  try {
    payload = JSON.parse(messageJson);
  } catch {
    return messageJson;
  }
  const { name, status, kind, started_at, ended_at, args, result } = payload ?? {};
  return JSON.stringify({
    type: 'tool_call',
    name,
    status,
    kind,
    started_at,
    ended_at,
    args: clipJson(args, TOOL_ARGS_LIMIT),
    result: clipJson(result, TOOL_RESULT_LIMIT),
  });
}

/**
 * Build one page of session messages for the GetAgentMessages MCP tool.
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
      message_json: row.type === 'tool_call' ? compactToolCall(messageJson) : messageJson,
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
