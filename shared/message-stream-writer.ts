import { dbRowFromPayload, dbPatchFromPayload } from './message-db-row.js';
import {
  hasNonemptyToolInput,
  mergeToolCallInput,
  toolInputFromPayload,
} from './merge-tool-call-input.js';
import type {
  AssistantBlock,
  AssistantMessagePayload,
  MessageOp,
  SessionMessagePayload,
  SystemMessagePayload,
  ToolCallPayload,
  TurnResultPayload,
} from './message-types.ts';

/** Throttle assistant row patches during streaming (UI still updates via `patched` events). */
const ASSISTANT_PATCH_DEBOUNCE_MS = 250;

/**
 * Per-provider builders for tool-call payloads. Each provider owns its own
 * canonical name / kind vocabulary, args coercion, and result envelope, so the
 * writer stays purely a row builder. See
 * `server/services/claude/claude-mapping.ts` (`claudeBuildToolCallStart` /
 * `claudeBuildToolCallComplete`) and `server/services/cursor/cursor-mapping.ts`
 * (`cursorBuildToolCallStart` / `cursorBuildToolCallComplete`).
 */
export type ToolCallBuilders = {
  buildToolCallStart: (
    callId: string,
    name: string,
    args: Record<string, unknown>,
    startedAt?: string
  ) => ToolCallPayload;
  buildToolCallComplete: (
    prev: ToolCallPayload,
    opts: {
      name?: string;
      args?: Record<string, unknown>;
      rawResult?: unknown;
      isError?: boolean;
      toolCallStatus?: string;
      endedAt?: string;
    }
  ) => ToolCallPayload;
};

export type WriterDeps = {
  sessionId: number;
  turnId: number;
  createRow: (row: Record<string, unknown>) => Promise<{ id: number }>;
  patchRow: (id: number, patch: Record<string, unknown>) => Promise<void>;
  appendRaw?: (event: unknown) => Promise<void>;
  builders: ToolCallBuilders;
};

type PendingTool = { id: number; payload: ToolCallPayload; rawInput: Record<string, unknown> };
type ToolStreamBlock = { callId: string; name: string; json: string };

/**
 * Applies canonical `MessageOp`s to `session_messages`.
 *
 * This class is provider-agnostic: it never sees a Claude or Cursor shape.
 * The agent mapping modules under `server/services/{claude,cursor}/` are the
 * only things that do, and they feed ops through {@link MessageStreamWriter.apply}.
 *
 * Per-provider knowledge is injected at construction via `deps.builders`; the
 * writer never imports from `server/services/`.
 */
export class MessageStreamWriter {
  readonly deps: WriterDeps;
  private pendingTools: Map<string, PendingTool>;
  private toolStreamByIndex: Map<number, ToolStreamBlock>;
  private assistantRowId: number | null;
  private assistantPayload: AssistantMessagePayload;
  private streamBufferKind: 'assistant' | 'thinking' | null;
  private thinkingTokensRowId: number | null;
  private _assistantPatchTimer: ReturnType<typeof setTimeout> | null;
  private _assistantPatchDirty: boolean;

  constructor(deps: WriterDeps) {
    this.deps = deps;
    this.pendingTools = new Map();
    this.toolStreamByIndex = new Map();
    this.assistantRowId = null;
    this.assistantPayload = { type: 'assistant', blocks: [] };
    this.streamBufferKind = null;
    this.thinkingTokensRowId = null;
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

  async log(event: unknown): Promise<void> {
    await this.deps.appendRaw?.(event);
  }

  async persistPayload(payload: SessionMessagePayload): Promise<{ id: number }> {
    const row = dbRowFromPayload(this.deps.sessionId, this.deps.turnId, payload);
    return this.deps.createRow(row);
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
    if (existing) (existing as { text: string }).text += text ?? '';
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
    if (block) (block as { thinking: string }).thinking += text ?? '';
    this.scheduleAssistantPatch();
  }

  async startTool(callId: string, name: string, args: Record<string, unknown>): Promise<number> {
    await this.flushAssistant();
    const rawInput = { ...args };
    const payload = this.deps.builders.buildToolCallStart(callId, name, rawInput);
    const { id } = await this.persistPayload(payload);
    this.pendingTools.set(callId, { id, payload, rawInput });
    return id;
  }

  /** Merge later tool_start frames (streaming args) into the running tool_call row. */
  async mergeToolStart(
    callId: string,
    name: string,
    input: Record<string, unknown>
  ): Promise<void> {
    const pending = this.pendingTools.get(callId);
    if (!pending) {
      await this.startTool(callId, name, input);
      return;
    }
    const merged = mergeToolCallInput(pending.rawInput, input);
    if (JSON.stringify(merged) === JSON.stringify(pending.rawInput)) return;

    pending.rawInput = merged;
    const payload = this.deps.builders.buildToolCallStart(
      callId,
      name || pending.payload.name,
      merged,
      pending.payload.started_at ?? new Date().toISOString()
    );
    const next: ToolCallPayload = {
      ...payload,
      status: pending.payload.status,
      result: pending.payload.result,
      ended_at: pending.payload.ended_at,
    };
    pending.payload = next;
    await this.patchPayload(pending.id, next);
  }

  async completeTool(
    callId: string,
    opts: {
      name?: string;
      args?: Record<string, unknown>;
      rawResult?: unknown;
      isError?: boolean;
      toolCallStatus?: string;
      endedAt?: string;
    }
  ): Promise<void> {
    const pending = this.pendingTools.get(callId);
    // A result can arrive without a matching start (e.g. a tool the SDK
    // replayed, or a call whose start event was dropped). Synthesise the
    // running form so the row is still complete and renderable.
    const base =
      pending?.payload ??
      this.deps.builders.buildToolCallStart(callId, opts.name ?? 'generic', opts.args ?? {});
    const rawInput = pending?.rawInput ?? toolInputFromPayload(base);
    const mergedArgs =
      opts.args != null && hasNonemptyToolInput(opts.args)
        ? mergeToolCallInput(rawInput, opts.args)
        : rawInput;
    const completed = this.deps.builders.buildToolCallComplete(base, {
      name: opts.name,
      args: mergedArgs,
      rawResult: opts.rawResult,
      isError: opts.isError,
      toolCallStatus: opts.toolCallStatus,
      endedAt: opts.endedAt,
    });
    if (pending?.id) await this.patchPayload(pending.id, completed);
    else await this.persistPayload(completed);
    this.pendingTools.delete(callId);
  }

  /**
   * Persist a system payload.
   *
   * `thinking_tokens` is a running counter the SDK re-reports on nearly every
   * event; it updates one tracked row rather than appending a row per event.
   * Every other system payload is a distinct line in the transcript.
   */
  async persistSystem(payload: SystemMessagePayload): Promise<void> {
    if (payload.subtype === 'thinking_tokens') {
      if (this.thinkingTokensRowId != null) {
        await this.patchPayload(this.thinkingTokensRowId, payload);
        return;
      }
      const { id } = await this.persistPayload(payload);
      this.thinkingTokensRowId = id;
      return;
    }
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
   * Persist a plan as a single typed row. Plan tools never produce tool_call
   * rows, and this is called once the complete plan text is available.
   */
  async persistPlan(markdown?: string | null): Promise<void> {
    await this.flushAssistant();
    await this.persistPayload({ type: 'plan', markdown: markdown ?? '' });
  }

  /**
   * Apply canonical ops.
   *
   * Ordering matters: text and thinking blocks accumulate into one assistant
   * row, so they do *not* flush; anything else flushes first to preserve
   * transcript order.
   */
  async apply(ops: MessageOp[] | null): Promise<void> {
    if (!ops || ops.length === 0) return;

    for (const op of ops) {
      switch (op.op) {
        case 'assistant_text':
          await this.appendAssistantText(op.text);
          continue;
        case 'assistant_thinking':
          await this.appendThinking(op.text);
          continue;
        default:
          break;
      }

      await this.flushAssistant();

      switch (op.op) {
        case 'tool_start':
          if (!this.pendingTools.has(op.call_id)) {
            await this.startTool(op.call_id, op.name, op.input);
          } else {
            await this.mergeToolStart(op.call_id, op.name, op.input);
          }
          break;
        case 'tool_stream_block_start':
          this.toolStreamByIndex.set(op.index, {
            callId: op.call_id,
            name: op.name,
            json: hasNonemptyToolInput(op.input) ? JSON.stringify(op.input) : '',
          });
          if (!this.pendingTools.has(op.call_id)) {
            await this.startTool(op.call_id, op.name, op.input);
          } else {
            await this.mergeToolStart(op.call_id, op.name, op.input);
          }
          break;
        case 'tool_stream_input_delta': {
          const block = this.toolStreamByIndex.get(op.index);
          if (!block) break;
          block.json += op.partial_json;
          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = JSON.parse(block.json) as Record<string, unknown>;
          } catch {
            break;
          }
          await this.mergeToolStart(block.callId, block.name, parsed);
          break;
        }
        case 'tool_result':
          await this.completeTool(op.call_id, {
            name: op.name,
            args: op.input,
            rawResult: op.raw,
            isError: op.is_error,
            toolCallStatus: op.status,
          });
          break;
        case 'plan':
          await this.persistPlan(op.markdown);
          break;
        case 'system':
          await this.persistSystem(op.payload);
          break;
        case 'turn_result':
          await this.persistTurnResult(op.payload);
          break;
        default:
          break;
      }
    }
  }

  /**
   * Close out the turn: flush buffered assistant text and settle any tool
   * still marked running (the SDK can abandon in-flight calls) so no row is
   * left dangling.
   */
  async finish(): Promise<void> {
    await this.flushAssistantPatch();
    await this.flushAssistant();
    this.resetThinkingTokensRow();
    for (const [callId, pending] of this.pendingTools) {
      if (pending.payload?.status === 'running') {
        await this.completeTool(callId, {
          name: pending.payload.name,
          args: pending.payload.args as Record<string, unknown>,
          rawResult: 'Turn ended before the tool finished',
          isError: false,
          toolCallStatus: 'cancelled',
        });
      }
    }
  }
}
