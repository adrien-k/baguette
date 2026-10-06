import { dbRowFromPayload, dbPatchFromPayload } from './message-db-row.js';
import {
  buildToolCallComplete,
  buildToolCallStart,
  mapClaudeAssistantPayload,
  mapClaudeTurnResult,
  planMarkdownFromToolInput,
} from './session-message-mappers.js';
import type {
  AssistantBlock,
  AssistantMessagePayload,
  SessionMessagePayload,
  SystemMessagePayload,
  ToolCallPayload,
  TurnResultPayload,
} from './session-messages.ts';

const PLAN_TOOL_NAMES = new Set(['ExitPlanMode', 'createPlan']);

/** Throttle assistant row patches during streaming (UI still updates via `patched` events). */
const ASSISTANT_PATCH_DEBOUNCE_MS = 250;

export type WriterDeps = {
  sessionId: number;
  turnId: number;
  createRow: (row: Record<string, unknown>) => Promise<{ id: number }>;
  patchRow: (id: number, patch: Record<string, unknown>) => Promise<void>;
  appendRaw?: (event: unknown) => Promise<void>;
};

/** Minimal structural shape of Cursor SDK run-stream events consumed here. */
export type CursorStreamEvent = {
  type?: string;
  status?: string;
  name?: string;
  call_id?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  text?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
};

/** Minimal structural shape of Claude agent SDK messages consumed here. */
export type ClaudeStreamEvent = {
  type?: string;
  subtype?: string;
  status?: string;
  isReplay?: boolean;
  message?: unknown;
  session_id?: string;
};

type PendingTool = { id: number; payload: ToolCallPayload };

export class MessageStreamWriter {
  readonly deps: WriterDeps;
  private pendingTools: Map<string, PendingTool>;
  private assistantRowId: number | null;
  private assistantPayload: AssistantMessagePayload;
  private streamBufferKind: 'assistant' | 'thinking' | null;

  constructor(deps: WriterDeps) {
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

  async log(event: unknown): Promise<void> {
    await this.deps.appendRaw?.(event);
  }

  async persistPayload(payload: SessionMessagePayload): Promise<{ id: number }> {
    const row = dbRowFromPayload(this.deps.sessionId, this.deps.turnId, payload);
    const created = await this.deps.createRow(row);
    return created;
  }

  async patchPayload(id: number, payload: SessionMessagePayload): Promise<void> {
    await this.deps.patchRow(id, dbPatchFromPayload(payload));
  }

  async flushAssistant(): Promise<void> {
    if (!this.assistantRowId) return;
    this.clearAssistantPatchTimer();
    this._assistantPatchDirty = false;
    await this.patchPayload(this.assistantRowId, this.assistantPayload);
    this.assistantRowId = null;
    this.assistantPayload = { type: 'assistant', blocks: [] };
    this.streamBufferKind = null;
  }

  async appendAssistantText(text?: string | null): Promise<void> {
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
    const blocks: AssistantBlock[] = this.assistantPayload.blocks;
    const existing = blocks.find((b) => b.type === 'text');
    if (existing) existing.text += text ?? '';
    else blocks.push({ type: 'text', text: text ?? '' });
    this.scheduleAssistantPatch();
  }

  async appendThinking(text?: string | null): Promise<void> {
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

  async startTool(callId: string, name: string, args: Record<string, unknown>): Promise<number> {
    await this.flushAssistant();
    const payload = buildToolCallStart(callId, name, args);
    const { id } = await this.persistPayload(payload);
    this.pendingTools.set(callId, { id, payload });
    return id;
  }

  async completeTool(
    callId: string,
    opts: {
      name?: string;
      args?: Record<string, unknown>;
      rawResult?: unknown;
      isError?: boolean;
      toolCallStatus?: string;
    }
  ): Promise<void> {
    const pending = this.pendingTools.get(callId);
    const base =
      pending?.payload ?? buildToolCallStart(callId, opts.name ?? 'generic', opts.args ?? {});
    const completed = buildToolCallComplete(base, {
      name: opts.name,
      args: opts.args,
      rawResult: opts.rawResult,
      isError: opts.isError,
      toolCallStatus: opts.toolCallStatus,
    });
    if (pending?.id) {
      await this.patchPayload(pending.id, completed);
    } else {
      await this.persistPayload(completed);
    }
    this.pendingTools.delete(callId);
  }

  async persistSystem(payload: SystemMessagePayload): Promise<void> {
    await this.flushAssistant();
    this.resetThinkingTokensRow();
    await this.persistPayload(payload);
  }

  async persistTurnResult(payload: TurnResultPayload): Promise<void> {
    await this.flushAssistant();
    this.resetThinkingTokensRow();
    await this.persistPayload(payload);
  }

  /**
   * Persist a plan tool call's markdown as a single typed plan row.
   * Plan tools never produce tool_call rows, and the caller only invokes this
   * once the SDK has delivered the complete plan.
   */
  async persistPlan(markdown?: string | null): Promise<void> {
    await this.flushAssistant();
    await this.persistPayload({ type: 'plan', markdown: markdown ?? '' });
  }

  isPlanToolName(name?: string): boolean {
    return PLAN_TOOL_NAMES.has(name ?? '');
  }

  /**
   * Map one Cursor run-stream event to typed creates/patches.
   * @param sdkMsg - Cursor stream event
   */
  async handleCursorEvent(sdkMsg: CursorStreamEvent): Promise<void> {
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
        // Cursor streams plan tool calls as repeated `running` events whose args.plan grows
        // each time; buffer them and persist a single plan row from the completed event
        // so one plan never fans out into multiple rows.
        if (sdkMsg.status === 'completed') {
          await this.persistPlan(planMarkdownFromToolInput(sdkMsg.args ?? {}));
        }
        return;
      }
      if (sdkMsg.status === 'running') {
        if (!this.pendingTools.has(sdkMsg.call_id ?? '')) {
          await this.startTool(sdkMsg.call_id ?? '', sdkMsg.name ?? 'generic', sdkMsg.args ?? {});
        }
        return;
      }
      await this.completeTool(sdkMsg.call_id ?? '', {
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
   * Map one Claude agent SDK message to typed creates/patches.
   * @param message - Claude agent SDK message
   */
  async handleClaudeEvent(message: ClaudeStreamEvent): Promise<void> {
    if (message.isReplay) return;
    await this.log(message);

    if (message.type === 'system' && message.subtype === 'thinking_tokens') {
      await this.updateThinkingTokens(message);
      return;
    }

    if (message.type === 'user') {
      const content = (message.message as { content?: unknown } | undefined)?.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        const b = block as {
          type?: string;
          tool_use_id?: string;
          content?: unknown;
          is_error?: boolean;
        };
        if (b.type !== 'tool_result') continue;
        if (!b.tool_use_id || !this.pendingTools.has(b.tool_use_id)) continue;
        await this.completeTool(b.tool_use_id, {
          rawResult: b.content,
          isError: Boolean(b.is_error),
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
        status:
          (message as { status?: string }).status ??
          (message as { message?: string }).message ??
          '',
      });
    }
  }

  async finish(): Promise<void> {
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
