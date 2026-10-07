import { mapPiEvent } from './pi-mapping.ts';
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

export async function processPiSessionStream(
  options: ProcessPiSessionStreamOptions
): Promise<ProcessPiSessionStreamResult> {
  const { writer, subscribe, runPrompt, abortSignal } = options;
  let finishedOk = false;
  let turnFailed = false;
  const turnUsage = emptyTurnUsage();

  let applyChain: Promise<void> = Promise.resolve();
  const unsubscribe = subscribe((event) => {
    void writer.log(event);
    if (event.type === 'turn_end') {
      const message = event.message as Record<string, unknown> | undefined;
      addPiTokenUsage(
        turnUsage,
        message?.usage as Record<string, unknown> | undefined,
        typeof message?.model === 'string' ? message.model : undefined
      );
    }
    if (event.type === 'auto_retry_end' && event.success === false) {
      turnFailed = true;
    }
    const ops = event.type === 'agent_settled' && turnFailed ? null : mapPiEvent(event);
    if (ops?.length) {
      for (const op of ops) {
        if (op.op === 'turn_result') {
          finishedOk = op.payload.status === 'ok';
        }
      }
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
      throw err;
    }
  } finally {
    unsubscribe();
    await applyChain;
    await writer.finish();
  }

  if (abortSignal?.aborted) finishedOk = false;
  return { finishedOk, turnUsage };
}
