/**
 * Stream one Cursor SDK run through a MessageStreamWriter.
 *
 * @param {import('@cursor/sdk').Run} run
 * @param {{
 *   writer: import('../../shared/message-stream-writer.ts').MessageStreamWriter,
 *   onUsage?: (sdkMsg: object) => void,
 *   onStatus?: (sdkMsg: object) => Promise<{ break: boolean, finishedOk?: boolean } | void>,
 *   abortSignal?: AbortSignal,
 * }} options
 */
export async function processCursorRunStream(run, options) {
  const { writer, onUsage, onStatus, abortSignal } = options;
  let finishedOk = false;
  let hasBackgroundTask = false;
  let pendingToolCount = 0;
  /** Call ids already counted while running, so repeated `running` deltas count once. */
  const countedCalls = new Set();

  for await (const sdkMsg of run.stream()) {
    if (abortSignal?.aborted) break;

    if (sdkMsg.type === 'tool_call') {
      // Plan tool calls (createPlan / ExitPlanMode) never produce tool rows — the writer
      // turns the completed call into a single plan row — so they must not be counted.
      const isPlanTool = writer.isPlanToolName(sdkMsg.name);
      if (sdkMsg.status === 'running') {
        if (!isPlanTool && sdkMsg.call_id && !countedCalls.has(sdkMsg.call_id)) {
          countedCalls.add(sdkMsg.call_id);
          pendingToolCount += 1;
        }
      } else if (!isPlanTool && countedCalls.delete(sdkMsg.call_id)) {
        pendingToolCount = Math.max(0, pendingToolCount - 1);
      }
    }

    if (sdkMsg.type === 'task') hasBackgroundTask = true;

    if (sdkMsg.type === 'usage') {
      onUsage?.(sdkMsg);
    }

    await writer.handleCursorEvent(sdkMsg);

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
