/** Minimum tool calls in a run before it collapses into a work summary. */
export const CHAT_WORK_COLLAPSE_MIN_CALLS = 6;

function toolUseNameIs(name, shortName) {
  if (!name) return false;
  if (name === shortName) return true;
  return name.endsWith(`__${shortName}`);
}

function nestedMcpToolName(block) {
  return (
    block.input?.toolName ?? block.input?.name ?? block.args?.toolName ?? block.args?.tool ?? null
  );
}

function blockIsNamedMcpTool(block, shortName) {
  if (block._hidden) return false;
  if (block.type === 'tool_call') {
    const name = block.name;
    if (toolUseNameIs(name, shortName)) return true;
    if (name === 'mcp' && toolUseNameIs(nestedMcpToolName(block), shortName)) return true;
    return false;
  }
  if (block.type !== 'tool_use') return false;
  if (toolUseNameIs(block.name, shortName)) return true;
  if (block.name === 'mcp' && toolUseNameIs(nestedMcpToolName(block), shortName)) return true;
  return false;
}

function blockIsLegacyPrUpsertBash(block) {
  if (block.type === 'tool_call' && block.kind === 'bash') {
    const cmd = block.args?.command;
    return typeof cmd === 'string' && cmd.trimStart().startsWith('baguette-op pr-upsert');
  }
  if (block.type !== 'tool_use' || block.name !== 'Bash') return false;
  const cmd = block.input?.command;
  return typeof cmd === 'string' && cmd.trimStart().startsWith('baguette-op pr-upsert');
}

/** MCP PrUpsert as Claude `mcp__…__PrUpsert`, Cursor `mcp` meta-tool, or legacy bash op. */
function blockIsPrUpsert(block) {
  return blockIsNamedMcpTool(block, 'PrUpsert') || blockIsLegacyPrUpsertBash(block);
}

function blockIsCreateIssue(block) {
  return blockIsNamedMcpTool(block, 'CreateIssue');
}

function messageIsToolCallRow(msg) {
  return msg?.type === 'tool_call';
}

/** Message whose visible tools include PrUpsert (MCP or legacy bash op). */
export function messageContainsPrUpsert(msg) {
  if (messageIsToolCallRow(msg)) return blockIsPrUpsert(msg);
  if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) return false;
  return msg.message.content.some(blockIsPrUpsert);
}

/** Message whose visible tools include CreateIssue. */
export function messageContainsCreateIssue(msg) {
  if (messageIsToolCallRow(msg)) return blockIsCreateIssue(msg);
  if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) return false;
  return msg.message.content.some(blockIsCreateIssue);
}

function messageContainsHighlightedTool(msg) {
  return messageContainsPrUpsert(msg) || messageContainsCreateIssue(msg);
}

/** User or assistant message with visible text — boundaries of a chat turn. */
export function isChatAnchorMessage(msg) {
  if (!msg) return false;
  if (msg.type === 'user') return true;
  if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
    return msg.message.content.some((b) => b.type === 'text' && String(b.text ?? '').trim());
  }
  if (msg.type === 'assistant' && Array.isArray(msg.blocks)) {
    return msg.blocks.some((b) => b.type === 'text' && String(b.text ?? '').trim());
  }
  return false;
}

/** User/assistant text, PrUpsert, or CreateIssue — splits work runs and enables collapse after the group. */
export function isChatGroupBoundary(msg) {
  return isChatAnchorMessage(msg) || messageContainsHighlightedTool(msg);
}

/** Tool-only assistant turns plus system/result noise between group boundaries. */
export function isChatWorkMessage(msg) {
  if (!msg) return false;
  if (messageContainsHighlightedTool(msg)) return false;
  if (msg.type === 'result' || msg.type === 'turn_result') return true;
  if (msg.type === 'tool_call') return true;
  if (msg.type === 'system') return msg.subtype !== 'prompt';
  if (msg.type === 'assistant') return !isChatAnchorMessage(msg);
  return false;
}

export function countToolCallsInMessages(messages) {
  let n = 0;
  for (const msg of messages) {
    if (msg.type === 'tool_call') {
      n += 1;
      continue;
    }
    if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) continue;
    for (const block of msg.message.content) {
      if (block.type === 'tool_use' && !block._hidden) n += 1;
    }
  }
  return n;
}

export function workSpanDurationMs(messages) {
  const times = messages
    .map((m) => m.created_at)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((t) => !Number.isNaN(t));
  if (times.length < 2) return 0;
  return Math.max(...times) - Math.min(...times);
}

/**
 * @returns {Array<
 *   | { kind: 'message', message: object, index: number }
 *   | { kind: 'work', messages: object[], indices: number[], callCount: number, durationMs: number }
 * >}
 */
export function groupChatDisplayMessages(messages) {
  const items = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (!isChatWorkMessage(msg)) {
      items.push({ kind: 'message', message: msg, index: i });
      i += 1;
      continue;
    }
    let j = i;
    while (j < messages.length && isChatWorkMessage(messages[j])) j += 1;
    const run = messages.slice(i, j);
    const indices = run.map((_, k) => i + k);
    const callCount = countToolCallsInMessages(run);
    const hasFutureBoundary = messages.slice(j).some(isChatGroupBoundary);
    if (hasFutureBoundary && callCount >= CHAT_WORK_COLLAPSE_MIN_CALLS) {
      items.push({
        kind: 'work',
        messages: run,
        indices,
        callCount,
        durationMs: workSpanDurationMs(run),
      });
    } else {
      for (let k = 0; k < run.length; k++) {
        items.push({ kind: 'message', message: run[k], index: i + k });
      }
    }
    i = j;
  }
  return items;
}
