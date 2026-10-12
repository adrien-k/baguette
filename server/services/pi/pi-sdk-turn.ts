import { mapPiEvent, piTurnResultOps } from './pi-mapping.ts';
import type { MessageOp } from '../../../shared/message-types.ts';
import type { MessageStreamWriter } from '../../../shared/message-stream-writer.ts';
import { addPiTokenUsage, emptyTurnUsage } from '../turn-usage.js';

export type PiTurnUsage = ReturnType<typeof emptyTurnUsage>;

export type ProcessPiSessionStreamOptions = {
  writer: MessageStreamWriter;
  subscribe: (listener: (event: Record<string, unknown>) => void) => () => void;
  runPrompt: () => Promise<void>;
  abortSignal?: AbortSignal;
};

export type ProcessPiSessionStreamResult = {
  finishedOk: boolean;
  turnUsage: PiTurnUsage;
};

function errorDetail(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  return fallback;
}

/** Pi marks provider failures on the assistant message (`stopReason: "error"`). */
function assistantTurnErrorMessage(message: Record<string, unknown> | undefined): string | null {
  if (!message || message.role !== 'assistant') return null;
  if (message.stopReason !== 'error') return null;
  return errorDetail(message.errorMessage, 'Model request failed');
}

export async function processPiSessionStream(
  options: ProcessPiSessionStreamOptions
): Promise<ProcessPiSessionStreamResult> {
  const { writer, subscribe, runPrompt, abortSignal } = options;
  let finishedOk = false;
  let turnFailed = false;
  let turnResultRecorded = false;
  let lastError: string | null = null;
  const turnUsage = emptyTurnUsage();

  let applyChain: Promise<void> = Promise.resolve();

  const noteTurnResultFromOps = (ops: MessageOp[]) => {
    for (const op of ops) {
      if (op.op === 'turn_result') {
        turnResultRecorded = true;
        finishedOk = op.payload.status === 'ok';
      }
    }
  };

  const markTurnFailed = (message: string) => {
    turnFailed = true;
    lastError = message;
  };

  const ensureFailureRecorded = async () => {
    if (turnResultRecorded || finishedOk) return;
    const detail = lastError ?? 'Pi agent turn failed before completing.';
    const ops = piTurnResultOps('error', detail);
    noteTurnResultFromOps(ops);
    await writer.apply(ops);
    finishedOk = false;
  };

  const unsubscribe = subscribe((event) => {
    void writer.log(event);

    if (event.type === 'extension_error') {
      markTurnFailed(errorDetail(event.error, 'Pi extension error'));
    }

    if (event.type === 'turn_end') {
      const message = event.message as Record<string, unknown> | undefined;
      addPiTokenUsage(
        turnUsage,
        message?.usage as Record<string, unknown> | undefined,
        typeof message?.model === 'string' ? message.model : undefined
      );
      const turnError = assistantTurnErrorMessage(message);
      if (turnError) markTurnFailed(turnError);
    }

    if (event.type === 'message_end') {
      const message = event.message as Record<string, unknown> | undefined;
      const turnError = assistantTurnErrorMessage(message);
      if (turnError) markTurnFailed(turnError);
    }

    if (event.type === 'auto_retry_end' && event.success === false) {
      turnFailed = true;
      lastError = errorDetail(event.finalError ?? event.errorMessage, 'Turn failed after retries');
    }

    // Pi still emits agent_settled after a failed assistant turn; do not treat that as success.
    const ops = event.type === 'agent_settled' && turnFailed ? null : mapPiEvent(event);
    if (ops?.length) {
      noteTurnResultFromOps(ops);
      applyChain = applyChain.then(() => writer.apply(ops));
    }
  });

  try {
    await runPrompt();
    await applyChain;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      finishedOk = false;
    } else {
      if (!lastError) lastError = errorDetail(err, 'Pi agent turn failed');
      turnFailed = true;
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

  if (abortSignal?.aborted) finishedOk = false;
  return { finishedOk, turnUsage };
}
