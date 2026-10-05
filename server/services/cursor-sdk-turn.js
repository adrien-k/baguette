/**
 * Stream one Cursor SDK run through a MessageStreamWriter.
 *
 * @param {import('@cursor/sdk').Run} run
 * @param {{
 *   writer: import('../../shared/message-stream-writer.js').MessageStreamWriter,
 *   onUsage?: (sdkMsg: object) => void,
 *   onStatus?: (sdkMsg: object) => Promise<{ break: boolean, finishedOk?: boolean } | void>,
 *   abortSignal?: AbortSignal,
 * }} options
 */
export async function processCursorRunStream(run, options) {
  const { writer, onUsage, onStatus, abortSignal } = options;
  let finishedOk = false;
  let sawFinished = false;
  let hasBackgroundTask = false;
  let pendingToolCount = 0;

  for await (const sdkMsg of run.stream()) {
    if (abortSignal?.aborted) break;

    if (sdkMsg.type === 'tool_call' && sdkMsg.status === 'running') {
      pendingToolCount += 1;
    }
    if (sdkMsg.type === 'tool_call' && sdkMsg.status !== 'running') {
      pendingToolCount = Math.max(0, pendingToolCount - 1);
    }

    if (sdkMsg.type === 'task') hasBackgroundTask = true;

    if (sdkMsg.type === 'usage') {
      onUsage?.(sdkMsg);
    }

    await writer.handleCursorEvent(sdkMsg);

    if (sdkMsg.type === 'status' && onStatus) {
      const result = await onStatus(sdkMsg);
      if (result?.break) {
        sawFinished = true;
        if (pendingToolCount === 0) {
          if (result.finishedOk) finishedOk = true;
          break;
        }
      }
    }
  }

  await writer.finish();
  // FINISHED means the agent turn ended; remaining pending tool rows should not keep the session running.
  if (sawFinished) finishedOk = true;
  return { finishedOk, hasBackgroundTask };
}
