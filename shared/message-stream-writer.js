import { dbRowFromPayload, dbPatchFromPayload } from './message-db-row.js';
import {
  buildToolCallComplete,
  buildToolCallStart,
  mapClaudeAssistantPayload,
  mapClaudeTurnResult,
  planMarkdownFromToolInput,
} from './session-message-mappers.js';

const PLAN_TOOL_NAMES = new Set(['ExitPlanMode', 'createPlan']);

/** Throttle assistant row patches during streaming (UI still updates via `patched` events). */
const ASSISTANT_PATCH_DEBOUNCE_MS = 250;

/**
 * @typedef {{
 *   sessionId: number;
 *   turnId: number;
 *   createRow: (row: object) => Promise<{ id: number }>;
 *   patchRow: (id: number, patch: object) => Promise<void>;
 *   appendRaw?: (event: unknown) => Promise<void>;
 * }} WriterDeps
 */

export class MessageStreamWriter {
  /** @param {WriterDeps} deps */
  constructor(deps) {
    this.deps = deps;
    this.pendingTools = new Map();
    this.assistantRowId = null;
    this.assistantPayload = { type: 'assistant', blocks: [] };
    this.streamBufferKind = null;
    /** @type {number|null} */
    this.thinkingTokensRowId = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this._assistantPatchTimer = null;
    this._assistantPatchDirty = false;
  }

  clearAssistantPatchTimer() {
    if (this._assistantPatchTimer != null) {
      clearTimeout(this._assistantPatchTimer);
      this._assistantPatchTimer = null;
    }
  }

  scheduleAssistantPatch() {
    this._assistantPatchDirty = true;
    if (this._assistantPatchTimer != null) return;
    this._assistantPatchTimer = setTimeout(() => {
      this._assistantPatchTimer = null;
      void this.flushAssistantPatch();
    }, ASSISTANT_PATCH_DEBOUNCE_MS);
  }

  async flushAssistantPatch() {
    this.clearAssistantPatchTimer();
    if (!this._assistantPatchDirty || !this.assistantRowId) return;
    this._assistantPatchDirty = false;
    await this.patchPayload(this.assistantRowId, this.assistantPayload);
  }

  resetThinkingTokensRow() {
    this.thinkingTokensRowId = null;
  }

  /** @param {object} sdkMsg */
  thinkingTokensPayload(sdkMsg) {
    return {
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: sdkMsg.estimated_tokens ?? null,
      estimated_tokens_delta: sdkMsg.estimated_tokens_delta ?? null,
    };
  }

  /** @param {object} sdkMsg */
  async updateThinkingTokens(sdkMsg) {
    const payload = this.thinkingTokensPayload(sdkMsg);
    if (this.thinkingTokensRowId != null) {
      await this.patchPayload(this.thinkingTokensRowId, payload);
      return;
    }
    const { id } = await this.persistPayload(payload);
    this.thinkingTokensRowId = id;
  }

  async log(event) {
    await this.deps.appendRaw?.(event);
  }

  async persistPayload(payload) {
    const row = dbRowFromPayload(this.deps.sessionId, this.deps.turnId, payload);
    const created = await this.deps.createRow(row);
    return created;
  }

  async patchPayload(id, payload) {
    await this.deps.patchRow(id, dbPatchFromPayload(payload));
  }

  async flushAssistant() {
    if (!this.assistantRowId) return;
    this.clearAssistantPatchTimer();
    this._assistantPatchDirty = false;
    await this.patchPayload(this.assistantRowId, this.assistantPayload);
    this.assistantRowId = null;
    this.assistantPayload = { type: 'assistant', blocks: [] };
    this.streamBufferKind = null;
  }

  async appendAssistantText(text) {
    if (!this.assistantRowId) {
      this.resetThinkingTokensRow();
      this.assistantPayload = {
        type: 'assistant',
        blocks: [{ type: 'text', text: text ?? '' }],
      };
      const { id } = await this.persistPayload(this.assistantPayload);
      this.assistantRowId = id;
      this.streamBufferKind = 'assistant';
      return;
    }
    const blocks = this.assistantPayload.blocks;
    const existing = blocks.find((b) => b.type === 'text');
    if (existing) existing.text += text ?? '';
    else blocks.push({ type: 'text', text: text ?? '' });
    this.scheduleAssistantPatch();
  }

  async appendThinking(text) {
    if (this.streamBufferKind !== 'thinking' || !this.assistantRowId) {
      await this.flushAssistant();
      this.resetThinkingTokensRow();
      this.assistantPayload = {
        type: 'assistant',
        blocks: [{ type: 'thinking', thinking: text ?? '' }],
      };
      const { id } = await this.persistPayload(this.assistantPayload);
      this.assistantRowId = id;
      this.streamBufferKind = 'thinking';
      return;
    }
    const block = this.assistantPayload.blocks.find((b) => b.type === 'thinking');
    if (block) block.thinking += text ?? '';
    this.scheduleAssistantPatch();
  }

  async startTool(callId, name, args) {
    await this.flushAssistant();
    const payload = buildToolCallStart(callId, name, args);
    const { id } = await this.persistPayload(payload);
    this.pendingTools.set(callId, { id, payload });
    return id;
  }

  async completeTool(callId, { name, args, rawResult, isError, toolCallStatus }) {
    const pending = this.pendingTools.get(callId);
    const base = pending?.payload ?? buildToolCallStart(callId, name ?? 'generic', args ?? {});
    const completed = buildToolCallComplete(base, {
      name,
      args,
      rawResult,
      isError,
      toolCallStatus,
    });
    if (pending?.id) {
      await this.patchPayload(pending.id, completed);
    } else {
      await this.persistPayload(completed);
    }
    this.pendingTools.delete(callId);
  }

  async persistSystem(payload) {
    await this.flushAssistant();
    this.resetThinkingTokensRow();
    await this.persistPayload(payload);
  }

  async persistTurnResult(payload) {
    await this.flushAssistant();
    this.resetThinkingTokensRow();
    await this.persistPayload(payload);
  }

  async persistPlan(markdown) {
    await this.flushAssistant();
    await this.persistPayload({
      type: 'plan',
      markdown: markdown ?? '',
    });
  }

  isPlanToolName(name) {
    return PLAN_TOOL_NAMES.has(name);
  }

  /**
   * @param {object} sdkMsg - Cursor stream event
   */
  async handleCursorEvent(sdkMsg) {
    await this.log(sdkMsg);

    if (sdkMsg.type === 'system' && sdkMsg.subtype === 'thinking_tokens') {
      await this.updateThinkingTokens(sdkMsg);
      return;
    }

    if (sdkMsg.type === 'assistant') {
      for (const block of sdkMsg.message?.content ?? []) {
        if (block.type === 'text') await this.appendAssistantText(block.text);
      }
      return;
    }

    if (sdkMsg.type === 'thinking') {
      await this.appendThinking(sdkMsg.text ?? '');
      return;
    }

    await this.flushAssistant();

    if (sdkMsg.type === 'tool_call') {
      if (this.isPlanToolName(sdkMsg.name)) {
        if (sdkMsg.status === 'running') {
          await this.persistPlan(planMarkdownFromToolInput(sdkMsg.args ?? {}));
        }
        return;
      }
      if (sdkMsg.status === 'running') {
        if (!this.pendingTools.has(sdkMsg.call_id)) {
          await this.startTool(sdkMsg.call_id, sdkMsg.name, sdkMsg.args ?? {});
        }
        return;
      }
      await this.completeTool(sdkMsg.call_id, {
        name: sdkMsg.name,
        args: sdkMsg.args,
        rawResult: sdkMsg.result,
        isError: sdkMsg.status === 'error',
        toolCallStatus: sdkMsg.status,
      });
      return;
    }

    if (sdkMsg.type === 'task' && sdkMsg.text) {
      await this.persistSystem({
        type: 'system',
        subtype: 'status',
        status: sdkMsg.text,
      });
    }
  }

  /**
   * @param {object} message - Claude agent SDK message
   */
  async handleClaudeEvent(message) {
    if (message.isReplay) return;
    await this.log(message);

    if (message.type === 'system' && message.subtype === 'thinking_tokens') {
      await this.updateThinkingTokens(message);
      return;
    }

    if (message.type === 'user') {
      const content = message.message?.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        if (!this.pendingTools.has(block.tool_use_id)) continue;
        await this.completeTool(block.tool_use_id, {
          rawResult: block.content,
          isError: Boolean(block.is_error),
        });
      }
      return;
    }

    if (message.type === 'assistant') {
      const { blocks, toolUses } = mapClaudeAssistantPayload(message);
      for (const b of blocks) {
        if (b.type === 'text') await this.appendAssistantText(b.text);
        if (b.type === 'thinking') await this.appendThinking(b.thinking);
      }
      for (const tu of toolUses) {
        if (this.isPlanToolName(tu.name)) {
          await this.persistPlan(planMarkdownFromToolInput(tu.input ?? {}));
          continue;
        }
        await this.startTool(tu.id, tu.name, tu.input ?? {});
      }
      return;
    }

    if (message.type === 'result') {
      await this.persistTurnResult(mapClaudeTurnResult(message));
      return;
    }

    if (message.type === 'system' && message.subtype === 'status') {
      await this.persistSystem({
        type: 'system',
        subtype: 'status',
        status: message.status ?? message.message ?? '',
      });
    }
  }

  async finish() {
    await this.flushAssistantPatch();
    await this.flushAssistant();
    this.resetThinkingTokensRow();
    for (const [callId, pending] of this.pendingTools) {
      if (pending.payload?.status === 'running') {
        await this.completeTool(callId, {
          name: pending.payload.name,
          args: pending.payload.args,
          rawResult: 'Turn ended before the tool finished',
          isError: false,
          toolCallStatus: 'cancelled',
        });
      }
    }
  }
}
