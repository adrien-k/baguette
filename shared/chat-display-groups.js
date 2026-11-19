import { isTurnStartingUserMessage } from './turn-model.js';

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

/** Message whose visible tools include PrUpsert (MCP or legacy bash op). */
export function messageContainsPrUpsert(msg) {
  if (messageIsToolCallRow(msg)) return blockIsPrUpsert(msg);
  if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) return false;
  return msg.message.content.some(blockIsPrUpsert);
}

/** Assistant row stamped by the writer as the turn's closing reply (before `turn_result`). */
export function isTurnReplyAssistantMessage(msg) {
  if (msg?.type !== 'assistant') return false;
  if (msg.turn_reply === true) return true;
  return false;
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
 * Per-index pointer to the final assistant text message of that index's turn.
 * Turns start at turn-starting user messages and end at the next user message
 * or turn result; `-1` means the index has no later assistant anchor in its turn.
 */
function computeTurnLastAnchorIndices(messages) {
  const result = new Array(messages.length).fill(-1);
  let lastAnchor = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    result[i] = lastAnchor;
    if (msg.type === 'assistant' && isChatAnchorMessage(msg)) lastAnchor = i;
    else if (
      isTurnStartingUserMessage(msg) ||
      msg.type === 'turn_result' ||
      msg.type === 'result'
    ) {
      lastAnchor = -1;
    }
  }
  return result;
}

/**
 * Assistant text message followed by another assistant text message in the same
 * turn — chatty models emit these mid-turn; they fold into the Worked group and
 * only the turn's last assistant message stays visible.
 */
function assistantIsMidTurn(msg, context) {
  if (msg?.type !== 'assistant' || !isChatAnchorMessage(msg)) return false;
  if (isTurnReplyAssistantMessage(msg)) return false;
  if (!Array.isArray(context?.turnLastAnchors) || context.index == null) return false;

  const last = context.turnLastAnchors[context.index];
  if (last !== -1 && last !== context.index) return true;

  if (!context.messages) return false;
  const { messages, index } = context;
  for (let i = index + 1; i < messages.length; i++) {
    const m = messages[i];
    if (isTurnStartingUserMessage(m)) break;
    if (m.type === 'turn_result' || m.type === 'result') continue;
    return true;
  }
  return false;
}

/**
 * User/assistant closing text — splits work runs (final reply of a turn only).
 * Mid-turn assistant messages fold into the Worked run instead of splitting it.
 */
export function isChatGroupBoundary(msg, context) {
  return isChatAnchorMessage(msg) && !assistantIsMidTurn(msg, context);
}

/**
 * Tool-only assistant turns, mid-turn assistant text, plus system/result noise
 * between group boundaries.
 */
export function isChatWorkMessage(msg, context) {
  if (!msg) return false;
  if (msg.type === 'result' || msg.type === 'turn_result') return true;
  if (msg.type === 'tool_call') return true;
  if (msg.type === 'system') return msg.subtype !== 'prompt';
  if (msg.type === 'assistant') {
    return !isChatAnchorMessage(msg) || assistantIsMidTurn(msg, context);
  }
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

function pushWorkRun(items, run, startIndex, { flat } = {}) {
  if (run.length === 0) return;
  if (flat) {
    pushMessageItems(items, run, startIndex);
    return;
  }
  pushWorkItem(items, run, startIndex, countToolCallsInMessages(run));
}

/**
 * @param {object[]} messages
 * @param {{ foldMidTurnAssistants?: boolean }} [opts]
 *   When false (used inside an expanded Worked group), assistant text messages
 *   always stay visible instead of folding into the surrounding work run.
 * @returns {Array<
 *   | { kind: 'message', message: object, index: number }
 *   | { kind: 'work', messages: object[], indices: number[], callCount: number, durationMs: number }
 * >}
 */
export function groupChatDisplayMessages(messages, opts = {}) {
  const flatWorkRuns = opts.foldMidTurnAssistants === false;
  const turnLastAnchors = flatWorkRuns ? null : computeTurnLastAnchorIndices(messages);
  const groupContext = (index) => ({
    messages,
    index,
    turnLastAnchors,
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
    pushWorkRun(items, run, i, { flat: flatWorkRuns });
    i = j;
  }
  return items;
}
