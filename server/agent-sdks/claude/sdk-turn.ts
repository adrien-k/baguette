/**
 * Stream one Claude Agent SDK query through a MessageStreamWriter.
 *
 * Claude Code surfaces user-role messages **mid-turn** — when the user types
 * while a turn is running, the SDK delivers them inline alongside the next
 * tool result, not as a separate conversation turn. Those messages still
 * carry `type: 'user'`, but they are *not* tool-result-only carriers; they
 * are real human text that has to flow through the writer as a `user`
 * payload. {@link isClaudeHumanUserMessage} is the predicate that
 * distinguishes them from the tool-result carriers the SDK also emits.
 *
 * Replays (`isReplay === true`) are skipped — they re-deliver already-
 * persisted rows from the SDK's session-replay path; re-writing them would
 * duplicate rows.
 *
 * Background tasks (subagents running in the background) keep the turn
 * alive after a `result` message arrives; the loop drains until
 * `pendingBackgroundTaskIds` is empty and the SDK auto-continuation window
 * has closed.
 *
 * Model-less results are not verdicts. When a `--resume` picks up a session whose
 * last turn died mid tool call, the CLI can flush a result with `num_turns === 0`
 * and empty text right after `init`, before it processes the prompt the host
 * pushed — while the stream keeps flowing (model request, tool calls). Treating
 * that result as the turn's end used to close the resumed turn seconds after it
 * started (its first tool permission then failed on the closed query), leaving
 * restart prompts and queued messages forever unanswered. The loop ignores
 * model-less results for turn completion; if the stream then ends without a real
 * result, the post-loop fallback closes the turn out with the model-less one
 * (the pre-fix behavior) instead of reporting a silent failure.
 */

import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { isClaudeHumanUserMessage, mapClaudeMessage } from './mapping.ts';
import type { MessageStreamWriter } from '../../../shared/message-stream-writer.ts';
import type { MessageOp } from '../../../shared/message-types.ts';

export type ClaudeStreamTurnOutcome = 'completed' | 'failed' | 'stopped';

/** After the parent `result`, wait this long for SDK auto-continuation before ending the turn. */
const POST_RESULT_CONTINUATION_MS = 60_000;

export type ClaudeStreamCallbacks = {
  /** Invoked when the SDK delivers an `init` event with a session_id. */
  onInitSessionId?: (sessionId: string) => Promise<void> | void;
  /**
   * Invoked on a `result` message. The return is the canonical verdict for
   * the just-finished turn; the caller decides what to do with it.
   */
  onResult?: (message: SDKMessage) => Promise<void> | void;
  /**
   * Invoked when the stream raises a non-`AbortError`. The standard helper
   * logs, surfaces to the user, and emits `app:error`.
   */
  onStreamError?: (err: Error) => Promise<void> | void;
  /**
   * Fallback persistence for the rare case where no writer is wired in
   * (e.g. replay/debug paths).
   */
  persistMessage?: (message: SDKMessage) => Promise<void>;
  /** Track background tasks and continue draining after the result message. */
  trackBackgroundTasks?: boolean;
};

export type ProcessClaudeQueryStreamOptions = {
  writer?: MessageStreamWriter | null;
  abortSignal?: AbortSignal;
} & ClaudeStreamCallbacks;

export type ProcessClaudeQueryStreamResult = {
  turnComplete: boolean;
  streamFailed: boolean;
  outcome: ClaudeStreamTurnOutcome;
  /** Last `result` message seen in this consume pass (may follow background auto-resume). */
  lastResult: SDKMessage | null;
};

type TaskStartedMessage = SDKMessage & {
  ambient?: boolean;
  task_id?: string;
  is_backgrounded?: boolean;
};

/**
 * A result that carries no model output: `success`, not an error, zero model turns,
 * empty text. Mirrors the CLI wrapper's own `modelLessTurnEnded` marker.
 */
function isModelLessResultMessage(message: SDKMessage): boolean {
  const result = message as {
    subtype?: string;
    is_error?: boolean;
    num_turns?: number;
    result?: string;
  };
  return (
    result.subtype === 'success' &&
    !result.is_error &&
    result.num_turns === 0 &&
    (result.result ?? '') === ''
  );
}

function shouldTrackTaskStarted(message: TaskStartedMessage): boolean {
  if (message.ambient) return false;
  const taskId = message.task_id;
  if (!taskId) return false;
  if (message.is_backgrounded === false) return false;
  return true;
}

function opsWithoutTurnResult(ops: MessageOp[] | null): MessageOp[] | null {
  if (!ops?.length) return null;
  const filtered = ops.filter((op) => op.op !== 'turn_result');
  return filtered.length > 0 ? filtered : null;
}

export async function processClaudeQueryStream(
  query: Query,
  options: ProcessClaudeQueryStreamOptions = {}
): Promise<ProcessClaudeQueryStreamResult> {
  const {
    writer,
    onInitSessionId,
    onResult,
    onStreamError,
    persistMessage,
    trackBackgroundTasks = false,
  } = options;

  const pendingBackgroundTaskIds = new Set<string>();
  let awaitingStreamContinuation = false;
  let continuationDeadline: number | null = null;
  let turnComplete = false;
  let streamFailed = false;
  let outcome: ClaudeStreamTurnOutcome = 'failed';
  let lastResult: SDKMessage | null = null;
  let deferredTurnResultMessage: SDKMessage | null = null;
  /** Last model-less result seen; becomes the fallback verdict if no real one arrives. */
  let modelLessResult: SDKMessage | null = null;

  const flushDeferredTurnResult = async () => {
    if (!deferredTurnResultMessage) return;
    const msg = deferredTurnResultMessage;
    deferredTurnResultMessage = null;
    if (writer) {
      await writer.log(msg);
      await writer.apply(mapClaudeMessage(msg));
    } else {
      await persistMessage?.(msg);
    }
  };

  const persistSdkMessage = async (message: SDKMessage) => {
    // A model-less result is not a verdict (see the module doc): hold the turn open and
    // defer its turn_result row — a real result supersedes it, and if the stream ends
    // without one, the post-loop fallback writes this row instead.
    if (message.type === 'result' && isModelLessResultMessage(message)) {
      modelLessResult = message;
      lastResult = message;
      if (!turnComplete) deferredTurnResultMessage = message;
      if (writer) {
        await writer.log(message);
        await writer.apply(opsWithoutTurnResult(mapClaudeMessage(message)));
      } else {
        await persistMessage?.(message);
      }
      return;
    }

    if (message.type === 'result') {
      // A real verdict supersedes any model-less result that may still be pending.
      modelLessResult = null;
      deferredTurnResultMessage = null;
    }

    // Defer the turn_result row until the consume loop finishes so the chat "Completed"
    // banner does not appear while the agent is still running (background tasks, SDK
    // auto-continuation, or terminal status not yet patched in processMessages).
    const deferTurnResult = trackBackgroundTasks && message.type === 'result';

    if (deferTurnResult) {
      deferredTurnResultMessage = message;
      if (writer) {
        await writer.log(message);
        await writer.apply(opsWithoutTurnResult(mapClaudeMessage(message)));
      }
      return;
    }

    if (writer) {
      await writer.log(message);
      await writer.apply(mapClaudeMessage(message));
    } else {
      await persistMessage?.(message);
    }
  };

  try {
    for await (const message of query) {
      // Replays re-deliver already-persisted rows from the SDK's session-replay path.
      if ((message as { isReplay?: boolean }).isReplay) continue;
      // Human user messages (typed or tool-result carriers) flow straight to the
      // writer as `user` payloads. The Claude SDK can surface these mid-turn
      // alongside a tool result, so we cannot gate on `turnComplete`.
      if (isClaudeHumanUserMessage(message)) {
        awaitingStreamContinuation = false;
        continuationDeadline = null;
        if (writer) {
          await writer.log(message);
          await writer.apply(mapClaudeMessage(message));
        } else {
          await persistMessage?.(message);
        }
        continue;
      }

      if (message.type === 'system' && message.subtype === 'init') {
        const sessionId = (message as { session_id?: string }).session_id;
        if (sessionId) await onInitSessionId?.(sessionId);
      }

      if (trackBackgroundTasks) {
        const m = message as SDKMessage & {
          ambient?: boolean;
          task_id?: string;
          status?: string;
        };
        if (message.type === 'system' && message.subtype === 'task_started') {
          if (shouldTrackTaskStarted(m as TaskStartedMessage)) {
            pendingBackgroundTaskIds.add(m.task_id as string);
          }
        }
        if (message.type === 'system' && message.subtype === 'task_notification' && !m.ambient) {
          const taskStatus = m.status;
          const isTerminal =
            taskStatus === 'completed' || taskStatus === 'failed' || taskStatus === 'error';
          if (isTerminal && m.task_id) {
            pendingBackgroundTaskIds.delete(m.task_id);
            if (turnComplete && pendingBackgroundTaskIds.size === 0) {
              awaitingStreamContinuation = true;
              continuationDeadline = Date.now() + POST_RESULT_CONTINUATION_MS;
            }
          }
        }
      }

      await persistSdkMessage(message);

      if (message.type === 'result' && !isModelLessResultMessage(message)) {
        turnComplete = true;
        awaitingStreamContinuation = false;
        continuationDeadline = null;
        const resultMsg = message as SDKMessage & {
          subtype?: string;
          is_error?: boolean;
        };
        const ok = resultMsg.subtype === 'success' && !resultMsg.is_error;
        outcome = ok ? 'completed' : 'failed';
        lastResult = message;
        await onResult?.(message);
      }

      if (turnComplete && pendingBackgroundTaskIds.size === 0) {
        if (awaitingStreamContinuation) {
          if (continuationDeadline != null && Date.now() >= continuationDeadline) {
            awaitingStreamContinuation = false;
            continuationDeadline = null;
            break;
          }
        } else {
          break;
        }
      }

      // The auto-continuation window is idle-based, not absolute: stream
      // activity after the task notification (a fresh init, thinking tokens,
      // tool calls, assistant output) proves the CLI is producing the
      // follow-up turn, so keep the turn open until that turn finishes.
      // Without this, a long-thinking continuation was aborted mid-turn at
      // the fixed deadline and its response never reached the user. The
      // deadline above still closes a silent window: an event arriving more
      // than POST_RESULT_CONTINUATION_MS after the previous one breaks first.
      if (awaitingStreamContinuation && message.type !== 'result') {
        continuationDeadline = Date.now() + POST_RESULT_CONTINUATION_MS;
      }
    }

    // Clean stream end with only a model-less result seen: the CLI never produced a
    // real verdict (e.g. it decided the pushed prompt needed no model turn). Close the
    // turn out with the model-less result — the pre-fix behavior — instead of leaving
    // the loop to report "ended without completing".
    if (modelLessResult && !turnComplete) {
      turnComplete = true;
      const resultMsg = modelLessResult as SDKMessage & {
        subtype?: string;
        is_error?: boolean;
      };
      const ok = resultMsg.subtype === 'success' && !resultMsg.is_error;
      outcome = ok ? 'completed' : 'failed';
      await onResult?.(modelLessResult);
    }
  } catch (err) {
    const error = err as Error;
    if (error.name !== 'AbortError') {
      await onStreamError?.(error);
      streamFailed = true;
      outcome = 'failed';
    } else {
      outcome = 'stopped';
    }
  }

  await flushDeferredTurnResult();

  return { turnComplete, streamFailed, outcome, lastResult };
}
