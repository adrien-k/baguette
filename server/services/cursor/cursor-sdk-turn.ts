/**
 * Stream one Cursor SDK run through a MessageStreamWriter.
 *
 * Cursor's SDK reports tool lifecycle in a single event carrying `status`
 * (`running` | `completed` | `error`); this loop counts in-flight tool calls
 * so the terminal-status break can wait for late completions, unwraps the
 * Cursor success envelope via `mapCursorEvent`, and lets the writer persist
 * each row. Plan tools never open a tool_call row — the writer turns them
 * into a single plan row on completion — so they are excluded from the
 * in-flight count.
 */

import type { Run, SDKMessage, SDKStatusMessage, SDKUsageMessage } from '@cursor/sdk';
import { isCursorPlanTool, mapCursorEvent } from './cursor-mapping.ts';
import type { MessageStreamWriter } from '../../../shared/message-stream-writer.ts';

function taskToolArgsBackgrounded(args: unknown): boolean {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  const a = args as Record<string, unknown>;
  return a.run_in_background === true || a.runInBackground === true;
}

/** True when the SDK signals a background subagent that may schedule a follow-up run. */
export function cursorSdkMessageIndicatesBackgroundWork(sdkMsg: SDKMessage): boolean {
  if (sdkMsg.type === 'task') return true;
  if (sdkMsg.type !== 'tool_call') return false;
  const name = sdkMsg.name;
  if (name !== 'Task' && name !== 'task') return false;
  return taskToolArgsBackgrounded(sdkMsg.args);
}

export type CursorStreamStatusCallback = (
  sdkMsg: SDKStatusMessage
) => Promise<{ break: boolean; finishedOk?: boolean } | void>;

export type CursorStreamUsageCallback = (sdkMsg: SDKUsageMessage) => void;

export type ProcessCursorRunStreamOptions = {
  writer: MessageStreamWriter;
  onUsage?: CursorStreamUsageCallback;
  onStatus?: CursorStreamStatusCallback;
  abortSignal?: AbortSignal;
};

export type ProcessCursorRunStreamResult = {
  finishedOk: boolean;
  hasBackgroundTask: boolean;
};

export async function processCursorRunStream(
  run: Run,
  options: ProcessCursorRunStreamOptions
): Promise<ProcessCursorRunStreamResult> {
  const { writer, onUsage, onStatus, abortSignal } = options;
  let finishedOk = false;
  let hasBackgroundTask = false;
  let pendingToolCount = 0;
  /** Call ids already counted while running, so repeated `running` deltas count once. */
  const countedCalls = new Set<string>();

  for await (const sdkMsg of run.stream()) {
    if (abortSignal?.aborted) break;

    if (sdkMsg.type === 'tool_call') {
      // Plan tool calls (createPlan / ExitPlanMode) never produce tool rows — the writer
      // turns the completed call into a single plan row — so they must not be counted.
      const isPlanTool = isCursorPlanTool(sdkMsg.name);
      if (sdkMsg.status === 'running') {
        if (!isPlanTool && sdkMsg.call_id && !countedCalls.has(sdkMsg.call_id)) {
          countedCalls.add(sdkMsg.call_id);
          pendingToolCount += 1;
        }
      } else if (!isPlanTool && countedCalls.delete(sdkMsg.call_id)) {
        pendingToolCount = Math.max(0, pendingToolCount - 1);
      }
    }

    if (cursorSdkMessageIndicatesBackgroundWork(sdkMsg)) hasBackgroundTask = true;

    if (sdkMsg.type === 'usage') {
      onUsage?.(sdkMsg);
    }

    await writer.log(sdkMsg);
    await writer.apply(mapCursorEvent(sdkMsg));

    if (sdkMsg.type === 'status' && onStatus) {
      const result = await onStatus(sdkMsg);
      if (result?.break) {
        // The terminal status is the authoritative turn verdict. The pending-tool count
        // only decides whether we can stop pulling now or keep draining the stream in
        // case late tool completions still arrive; it never overrides the verdict — the
        // SDK can abandon in-flight calls (observed: a parallel `read` around createPlan
        // that never completes) and writer.finish() closes those rows out as errors.
        if (result.finishedOk) finishedOk = true;
        if (pendingToolCount === 0) break;
      }
    }
  }

  await writer.finish();
  return { finishedOk, hasBackgroundTask };
}
