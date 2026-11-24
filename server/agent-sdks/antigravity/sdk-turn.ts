import type { PromptResponse, SessionNotification } from '@agentclientprotocol/sdk/unstable';
import {
  baguetteMcpShortName,
  isBaguetteMcpToolName,
} from '../../../shared/baguette-mcp-tool-names.js';
import type { MessageStreamWriter } from '../../../shared/message-stream-writer.ts';
import type { MessageOp } from '../../../shared/message-types.ts';
import { emptyTurnUsage } from '../../services/turn-usage.js';
import type { CapturedMcpToolResult } from './mcp-bridge.ts';
import { antigravityTurnResultOps, mapAntigravityUpdate, type TrackedToolMeta } from './mapping.ts';

export type AntigravityTurnUsage = Omit<ReturnType<typeof emptyTurnUsage>, 'model'> & {
  model: string | null;
};

export type ProcessAntigravityTurnStreamOptions = {
  writer: MessageStreamWriter;
  subscribe: (listener: (notification: SessionNotification) => void) => () => void;
  runPrompt: () => Promise<PromptResponse | null | undefined>;
  consumeMcpToolResult?: (shortToolName: string) => CapturedMcpToolResult | null;
  model?: string | null;
  abortSignal?: AbortSignal;
};

export type ProcessAntigravityTurnStreamResult = {
  finishedOk: boolean;
  turnUsage: AntigravityTurnUsage;
  lastError: string | null;
  stopReason: string | null;
};

function errorDetail(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  return fallback;
}

function addAcpPromptUsage(
  acc: AntigravityTurnUsage,
  usage: PromptResponse['usage'] | null | undefined
): void {
  if (!usage) return;
  const input = Number(usage.inputTokens) || 0;
  const output = Number(usage.outputTokens) || 0;
  const cacheRead = Number(usage.cachedReadTokens) || 0;
  const cacheWrite = Number(usage.cachedWriteTokens) || 0;
  const thought = Number(usage.thoughtTokens) || 0;
  acc.input_tokens += input;
  acc.output_tokens += output;
  acc.cache_read_tokens += cacheRead;
  acc.cache_write_tokens += cacheWrite;
  acc.reasoning_tokens += thought;
  const total = Number(usage.totalTokens) || input + output + cacheRead + cacheWrite;
  acc.total_tokens += total;
}

export async function processAntigravityTurnStream(
  options: ProcessAntigravityTurnStreamOptions
): Promise<ProcessAntigravityTurnStreamResult> {
  const { writer, subscribe, runPrompt, consumeMcpToolResult, model = null, abortSignal } = options;
  let finishedOk = false;
  let turnResultRecorded = false;
  let lastError: string | null = null;
  let stopReason: string | null = null;
  const turnUsage: AntigravityTurnUsage = { ...emptyTurnUsage(), model };

  const toolMetaById = new Map<string, TrackedToolMeta>();
  let applyChain: Promise<void> = Promise.resolve();

  const noteTurnResultFromOps = (ops: MessageOp[]) => {
    for (const op of ops) {
      if (op.op === 'turn_result') {
        turnResultRecorded = true;
        finishedOk = op.payload.status === 'ok';
      }
    }
  };

  const applyOps = (ops: MessageOp[] | null | undefined) => {
    if (!ops?.length) return;
    const effective = abortSignal?.aborted ? ops.filter((op) => op.op !== 'turn_result') : ops;
    if (!effective.length) return;
    noteTurnResultFromOps(effective);
    applyChain = applyChain.then(() => writer.apply(effective));
  };

  const ensureFailureRecorded = async () => {
    if (turnResultRecorded || finishedOk) return;
    if (abortSignal?.aborted) return;
    const detail = lastError ?? 'Antigravity agent turn failed before completing.';
    const ops = antigravityTurnResultOps('error', detail);
    noteTurnResultFromOps(ops);
    await writer.apply(ops);
    finishedOk = false;
  };

  const backfillMcpResults = (ops: MessageOp[]) => {
    if (!consumeMcpToolResult) return;
    for (const op of ops) {
      if (op.op !== 'tool_result') continue;
      const meta = toolMetaById.get(op.call_id);
      const effectiveName = op.name ?? meta?.name ?? '';
      if (!isBaguetteMcpToolName(effectiveName)) continue;
      if (op.raw !== undefined) continue;
      const shortName = baguetteMcpShortName(effectiveName);
      const captured = consumeMcpToolResult(shortName);
      if (!captured) continue;
      op.raw = captured.raw;
      if (captured.isError) {
        op.is_error = true;
        op.status = 'error';
      }
    }
  };

  const updateTrackedMeta = (ops: MessageOp[]) => {
    for (const op of ops) {
      if (op.op === 'tool_start') {
        const prev = toolMetaById.get(op.call_id) ?? {};
        toolMetaById.set(op.call_id, {
          name: op.name && op.name !== 'generic' ? op.name : prev.name,
          input:
            Object.keys(op.input).length > 0 ? { ...(prev.input ?? {}), ...op.input } : prev.input,
        });
      }
    }
  };

  const unsubscribe = subscribe((notification) => {
    void writer.log(notification);
    const update = notification?.update;
    if (!update) return;

    const toolCallId = (update as { toolCallId?: unknown }).toolCallId;
    const trackedMeta = typeof toolCallId === 'string' ? toolMetaById.get(toolCallId) : undefined;
    const ops = mapAntigravityUpdate(update, trackedMeta);
    if (!ops?.length) return;

    updateTrackedMeta(ops);
    backfillMcpResults(ops);
    applyOps(ops);
  });

  try {
    const response = await runPrompt();
    addAcpPromptUsage(turnUsage, response?.usage);
    stopReason = response?.stopReason ?? 'end_turn';

    if (abortSignal?.aborted) {
      finishedOk = false;
    } else if (stopReason === 'refusal') {
      lastError = 'Model refused to respond';
      applyOps(antigravityTurnResultOps('error', lastError));
      finishedOk = false;
    } else if (stopReason === 'cancelled') {
      lastError = 'Antigravity turn was cancelled';
      applyOps(antigravityTurnResultOps('error', lastError));
      finishedOk = false;
    } else {
      applyOps(antigravityTurnResultOps('ok', null));
      finishedOk = true;
    }
    await applyChain;
  } catch (err) {
    if ((err as Error).name === 'AbortError' || abortSignal?.aborted) {
      finishedOk = false;
      lastError = null;
    } else {
      lastError = errorDetail(err, 'Antigravity agent turn failed');
      await applyChain;
      await ensureFailureRecorded();
      throw err;
    }
  } finally {
    unsubscribe();
    await applyChain;
    await ensureFailureRecorded();
    await writer.finish();
  }

  if (abortSignal?.aborted) {
    finishedOk = false;
    lastError = null;
  }
  return { finishedOk, turnUsage, lastError, stopReason };
}
