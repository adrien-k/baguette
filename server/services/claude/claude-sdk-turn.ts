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
 * `pendingBackgroundTaskIds` is empty and no auto-resume is pending.
 */

import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { isClaudeHumanUserMessage, mapClaudeMessage } from './claude-mapping.ts';
import { SDK_QUERY_CLOSED_MESSAGE } from '../../claude-agent-sdk-constants.js';
import type { MessageStreamWriter } from '../../../shared/message-stream-writer.ts';

export type ClaudeStreamTurnOutcome = 'completed' | 'failed' | 'stopped';

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
   * Persisted as a typed `system` row when the stream ends in failure.
   */
  persistStatus?: (text: string) => Promise<void>;
  /**
   * Fallback persistence for the rare case where no writer is wired in
   * (e.g. replay/debug paths).
   */
  persistMessage?: (message: SDKMessage) => Promise<void>;
  /**
   * Fired when a background task ends after the result and there are no
   * more pending — service decides what "resume" means.
   */
  onBackgroundAutoResume?: () => Promise<void> | void;
  /** Track background tasks and continue draining after the result message. */
  trackBackgroundTasks?: boolean;
  /** Shown to the user when the SDK closes the query mid-turn. */
  connectionClosedHint?: string;
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

export async function processClaudeQueryStream(
  query: Query,
  options: ProcessClaudeQueryStreamOptions = {}
): Promise<ProcessClaudeQueryStreamResult> {
  const {
    writer,
    onInitSessionId,
    onResult,
    onStreamError,
    persistStatus,
    persistMessage,
    onBackgroundAutoResume,
    trackBackgroundTasks = false,
    connectionClosedHint = 'Agent connection closed before the response finished. Try sending your message again.',
  } = options;

  const pendingBackgroundTaskIds = new Set<string>();
  let awaitingAutoResume = false;
  let turnComplete = false;
  let streamFailed = false;
  let outcome: ClaudeStreamTurnOutcome = 'failed';
  let lastResult: SDKMessage | null = null;

  try {
    for await (const message of query) {
      // Replays re-deliver already-persisted rows from the SDK's session-replay path.
      if ((message as { isReplay?: boolean }).isReplay) continue;
      // Human user messages (typed or tool-result carriers) flow straight to the
      // writer as `user` payloads. The Claude SDK can surface these mid-turn
      // alongside a tool result, so we cannot gate on `turnComplete`.
      if (isClaudeHumanUserMessage(message)) {
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
        if (message.type === 'system' && message.subtype === 'task_started' && !m.ambient) {
          pendingBackgroundTaskIds.add(m.task_id ?? '');
        }
        if (message.type === 'system' && message.subtype === 'task_notification' && !m.ambient) {
          const taskStatus = m.status;
          const isTerminal =
            taskStatus === 'completed' || taskStatus === 'failed' || taskStatus === 'error';
          if (isTerminal) {
            pendingBackgroundTaskIds.delete(m.task_id ?? '');
            if (turnComplete && pendingBackgroundTaskIds.size === 0) {
              awaitingAutoResume = true;
              await onBackgroundAutoResume?.();
            }
          }
        }
      }

      if (writer) {
        await writer.log(message);
        await writer.apply(mapClaudeMessage(message));
      } else {
        await persistMessage?.(message);
      }

      if (message.type === 'result') {
        turnComplete = true;
        awaitingAutoResume = false;
        const resultMsg = message as SDKMessage & {
          subtype?: string;
          is_error?: boolean;
        };
        const ok = resultMsg.subtype === 'success' && !resultMsg.is_error;
        outcome = ok ? 'completed' : 'failed';
        lastResult = message;
        await onResult?.(message);
      }

      if (turnComplete && pendingBackgroundTaskIds.size === 0 && !awaitingAutoResume) {
        break;
      }
    }
  } catch (err) {
    const error = err as Error;
    if (error.name !== 'AbortError') {
      const userFacing =
        error.message === SDK_QUERY_CLOSED_MESSAGE ? connectionClosedHint : error.message;
      try {
        await persistStatus?.(userFacing);
      } catch {
        // persistStatus is best-effort; the caller has already been notified via onStreamError.
      }
      await onStreamError?.(error);
      streamFailed = true;
      outcome = 'failed';
    } else {
      outcome = 'stopped';
    }
  }

  return { turnComplete, streamFailed, outcome, lastResult };
}
