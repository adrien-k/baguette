import { TURN_ENDING_BAGUETTE_TOOLS, baguetteMcpShortName } from './baguette-mcp-tool-names.js';

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

/** MCP PrUpsert / UpdateSession, Cursor `mcp` meta-tool, or legacy bash pr-upsert op. */
function blockIsPrUpsert(block) {
  return (
    blockIsNamedMcpTool(block, 'PrUpsert') ||
    blockIsNamedMcpTool(block, 'UpdateSession') ||
    blockIsLegacyPrUpsertBash(block)
  );
}

function messageIsToolCallRow(msg) {
  return msg?.type === 'tool_call';
}

function toolCallRowIsTurnEndingTool(msg) {
  if (!messageIsToolCallRow(msg)) return false;
  if (msg.kind === 'ask_user') return true;
  if (msg.kind === 'mcp') {
    const tool = msg.args?.tool ?? baguetteMcpShortName(msg.name);
    return TURN_ENDING_BAGUETTE_TOOLS.has(tool);
  }
  const short = baguetteMcpShortName(msg.name) || msg.name;
  return TURN_ENDING_BAGUETTE_TOOLS.has(short);
}

function blockIsTurnEndingTool(block) {
  if (block._hidden) return false;
  if (blockIsNamedMcpTool(block, 'CreatePlan')) return true;
  if (blockIsNamedMcpTool(block, 'EditPlan')) return true;
  if (blockIsNamedMcpTool(block, 'AskUserQuestions')) return true;
  if (block.type === 'tool_use') {
    const n = block.name;
    if (n === 'AskUserQuestion' || n === 'AskUserQuestions') return true;
  }
  return false;
}

/** CreatePlan, EditPlan, or AskUserQuestions — always visible, never inside Worked. */
export function messageContainsTurnEndingTool(msg) {
  if (toolCallRowIsTurnEndingTool(msg)) return true;
  if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) return false;
  return msg.message.content.some(blockIsTurnEndingTool);
}

/** Message whose visible tools include PrUpsert (MCP or legacy bash op). */
export function messageContainsPrUpsert(msg) {
  if (messageIsToolCallRow(msg)) return blockIsPrUpsert(msg);
  if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) return false;
  return msg.message.content.some(blockIsPrUpsert);
}

/** Index of the last message containing PrUpsert, or -1 if none. */
function findLastPrUpsertMessageIndex(messages) {
  let last = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messageContainsPrUpsert(messages[i])) last = i;
  }
  return last;
}

function prUpsertIsDisplayBoundary(msg, context) {
  if (!messageContainsPrUpsert(msg)) return false;
  if (!context) return true;
  const { messages, index, lastPrUpsertIndex } = context;
  const last =
    lastPrUpsertIndex !== undefined
      ? lastPrUpsertIndex
      : messages
        ? findLastPrUpsertMessageIndex(messages)
        : -1;
  return index === last;
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

/**
 * User/assistant text or the last PrUpsert — splits work runs and enables collapse.
 * @param {object} [context] When grouping, pass `{ messages, index }` so only the last PrUpsert is a boundary.
 */
export function isChatGroupBoundary(msg, context) {
  return (
    isChatAnchorMessage(msg) ||
    prUpsertIsDisplayBoundary(msg, context) ||
    messageContainsTurnEndingTool(msg)
  );
}

/** Tool-only assistant turns plus system/result noise between group boundaries. */
export function isChatWorkMessage(msg, context) {
  if (!msg) return false;
  if (messageContainsTurnEndingTool(msg)) return false;
  if (prUpsertIsDisplayBoundary(msg, context)) return false;
  if (msg.type === 'result' || msg.type === 'turn_result') return true;
  if (msg.type === 'tool_call') return true;
  if (msg.type === 'system') return msg.subtype !== 'prompt';
  if (msg.type === 'assistant') return !isChatAnchorMessage(msg);
  return false;
}

function countToolCallsInMessages(messages) {
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

function workSpanDurationMs(messages) {
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
  const lastPrUpsertIndex = findLastPrUpsertMessageIndex(messages);
  const groupContext = (index) => ({
    messages,
    index,
    lastPrUpsertIndex,
  });
  const items = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (!isChatWorkMessage(msg, groupContext(i))) {
      items.push({ kind: 'message', message: msg, index: i });
      i += 1;
      continue;
    }
    let j = i;
    while (j < messages.length && isChatWorkMessage(messages[j], groupContext(j))) j += 1;
    const run = messages.slice(i, j);
    const indices = run.map((_, k) => i + k);
    const callCount = countToolCallsInMessages(run);
    const hasFutureBoundary = messages
      .slice(j)
      .some((m, k) => isChatGroupBoundary(m, groupContext(j + k)));
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
