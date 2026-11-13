import { TURN_ENDING_BAGUETTE_TOOLS, baguetteMcpShortName } from './baguette-mcp-tool-names.js';

/** Minimum tool calls in a run before it collapses into a work summary. */
export const CHAT_WORK_COLLAPSE_MIN_CALLS = 6;

/** How many of the newest tool calls stay expanded in an open (in-progress or expanded) work run. */
export const CHAT_WORK_VISIBLE_TAIL_CALLS = 10;

/** Chat-pinned MCP tools: always visible, never inside Worked. Includes turn-ending tools. */
const CHAT_PINNED_BAGUETTE_TOOLS = new Set([...TURN_ENDING_BAGUETTE_TOOLS, 'StartSubagent']);

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

function toolCallRowShortName(msg) {
  if (msg.kind === 'mcp') return msg.args?.tool ?? baguetteMcpShortName(msg.name);
  return baguetteMcpShortName(msg.name) || msg.name;
}

function toolCallRowIsPinnedChatTool(msg) {
  if (!messageIsToolCallRow(msg)) return false;
  if (msg.kind === 'ask_user') return true;
  return CHAT_PINNED_BAGUETTE_TOOLS.has(toolCallRowShortName(msg));
}

function blockIsPinnedChatTool(block) {
  if (block._hidden) return false;
  if (blockIsNamedMcpTool(block, 'CreatePlan')) return true;
  if (blockIsNamedMcpTool(block, 'EditPlan')) return true;
  if (blockIsNamedMcpTool(block, 'AskUserQuestions')) return true;
  if (blockIsNamedMcpTool(block, 'StartSubagent')) return true;
  if (block.type === 'tool_use') {
    const n = block.name;
    if (n === 'AskUserQuestion' || n === 'AskUserQuestions') return true;
  }
  return false;
}

/** CreatePlan, EditPlan, AskUserQuestions, or StartSubagent — always visible, never inside Worked. */
export function messageContainsPinnedChatTool(msg) {
  if (toolCallRowIsPinnedChatTool(msg)) return true;
  if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) return false;
  return msg.message.content.some(blockIsPinnedChatTool);
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
    messageContainsPinnedChatTool(msg)
  );
}

/** Tool-only assistant turns plus system/result noise between group boundaries. */
export function isChatWorkMessage(msg, context) {
  if (!msg) return false;
  if (messageContainsPinnedChatTool(msg)) return false;
  if (prUpsertIsDisplayBoundary(msg, context)) return false;
  if (msg.type === 'result' || msg.type === 'turn_result') return true;
  if (msg.type === 'tool_call') return true;
  if (msg.type === 'system') return msg.subtype !== 'prompt';
  if (msg.type === 'assistant') return !isChatAnchorMessage(msg);
  return false;
}

function toolCallCountInMessage(msg) {
  if (msg?.type === 'tool_call') return 1;
  if (msg?.type !== 'assistant' || !Array.isArray(msg.message?.content)) return 0;
  let n = 0;
  for (const block of msg.message.content) {
    if (block.type === 'tool_use' && !block._hidden) n += 1;
  }
  return n;
}

function countToolCallsInMessages(messages) {
  let n = 0;
  for (const msg of messages) n += toolCallCountInMessage(msg);
  return n;
}

/**
 * Index in `run` where the visible tail starts so the tail holds at most `tailCalls` tool calls.
 * Returns 0 when the whole run fits in the tail.
 */
export function findWorkRunVisibleTailStart(run, tailCalls = CHAT_WORK_VISIBLE_TAIL_CALLS) {
  let callsFromEnd = 0;
  for (let k = run.length - 1; k >= 0; k--) {
    const n = toolCallCountInMessage(run[k]);
    if (n === 0) continue;
    callsFromEnd += n;
    if (callsFromEnd >= tailCalls) return k;
  }
  return 0;
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

function pushWorkItem(items, messages, startIndex, callCount) {
  items.push({
    kind: 'work',
    messages,
    indices: messages.map((_, k) => startIndex + k),
    callCount,
    durationMs: workSpanDurationMs(messages),
  });
}

function pushMessageItems(items, messages, startIndex) {
  for (let k = 0; k < messages.length; k++) {
    items.push({ kind: 'message', message: messages[k], index: startIndex + k });
  }
}

function pushWorkRun(items, run, startIndex, { collapseAll }) {
  const callCount = countToolCallsInMessages(run);
  if (collapseAll && callCount >= CHAT_WORK_COLLAPSE_MIN_CALLS) {
    pushWorkItem(items, run, startIndex, callCount);
    return;
  }
  if (callCount > CHAT_WORK_VISIBLE_TAIL_CALLS) {
    const split = findWorkRunVisibleTailStart(run);
    const prefix = run.slice(0, split);
    const prefixCalls = countToolCallsInMessages(prefix);
    if (prefixCalls > 0) {
      pushWorkItem(items, prefix, startIndex, prefixCalls);
      pushMessageItems(items, run.slice(split), startIndex + split);
      return;
    }
  }
  pushMessageItems(items, run, startIndex);
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
    const hasFutureBoundary = messages
      .slice(j)
      .some((m, k) => isChatGroupBoundary(m, groupContext(j + k)));
    pushWorkRun(items, run, i, { collapseAll: hasFutureBoundary });
    i = j;
  }
  return items;
}
