/**
 * Pi extension: spill oversized tool results to per-session files instead of
 * sending them to the model.
 *
 * Two layers of defense against context-length failures from unbounded tool
 * output (see the 864k-token PrWorkflowLogs incident):
 *
 * 1. `tool_result` — spills any result (built-in, custom, or external MCP)
 *    whose text exceeds MAX_TOOL_RESULT_BYTES to `<cwd>/.data/tool-results/`
 *    before it is persisted, replacing the content with a pointer notice.
 * 2. `context` — request-local transform applied before every LLM call, so a
 *    tool result that is already oversized in persisted history (older
 *    sessions, or results captured before this extension existed) is spilled
 *    on the wire instead of blowing the model's context window. When spill
 *    occurs, a registered Baguette hook backfills `session_messages` tool_call
 *    rows for this session only (see `prepareAgentTurnCompaction`).
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getBaguetteToolMessageCompactionHook } from '../../../services/agent-turn-compaction.js';
import {
  MAX_TOOL_RESULT_BYTES,
  spilledResultNotice,
  spillTextToFile,
  TOOL_RESULTS_DIR,
} from '../../../services/mcp/lib/spill-oversized-results.js';
import path from 'node:path';

function isTextBlock(block) {
  return block?.type === 'text' && typeof block.text === 'string';
}

/**
 * Spill oversized text blocks in a tool-result content array.
 * @returns {Promise<Array|null>} new content array when changed, otherwise null
 */
async function spillContent(content, baseDir, cwd, toolName) {
  if (!Array.isArray(content)) return null;
  let changed = false;
  const next = [];
  for (const block of content) {
    if (isTextBlock(block) && Buffer.byteLength(block.text, 'utf8') > MAX_TOOL_RESULT_BYTES) {
      const { absolutePath, totalBytes } = await spillTextToFile(baseDir, toolName, block.text);
      const relativePath = path.relative(cwd, absolutePath).split(path.sep).join('/');
      next.push({ ...block, text: spilledResultNotice(relativePath, totalBytes) });
      changed = true;
    } else {
      next.push(block);
    }
  }
  return changed ? next : null;
}

function spillDirFor(cwd) {
  return path.join(cwd, TOOL_RESULTS_DIR);
}

/**
 * @param {number} [baguetteSessionId] Baguette repo session id for compaction hook lookup
 */
export function createSpillOversizedToolResultsExtension(baguetteSessionId?: number) {
  return function spillOversizedToolResultsExtension(pi: ExtensionAPI) {
    pi.on('tool_result', async (event, ctx) => {
      const content = await spillContent(
        event.content,
        spillDirFor(ctx.cwd),
        ctx.cwd,
        event.toolName
      );
      if (content === null) return undefined;
      // Omitting structuredContent drops it alongside the replaced content, as
      // required when redacting content.
      return { content };
    });

    pi.on('context', async (event, ctx) => {
      let changed = false;
      const baseDir = spillDirFor(ctx.cwd);
      const messages = [];
      for (const message of event.messages) {
        if (message?.role !== 'toolResult') {
          messages.push(message);
          continue;
        }
        const content = await spillContent(message.content, baseDir, ctx.cwd, message.toolName);
        if (content === null) {
          messages.push(message);
        } else {
          changed = true;
          messages.push({ ...message, content });
        }
      }
      if (!changed) return undefined;
      const compactHook = getBaguetteToolMessageCompactionHook(baguetteSessionId);
      if (compactHook) {
        await compactHook();
      }
      return { messages };
    });
  };
}

export default createSpillOversizedToolResultsExtension();
