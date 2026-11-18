/**
 * Classify terminal Cursor run statuses so failures bubble up to the user.
 *
 * Observed in session 922 (turn 10, 2026-10-26): Cursor's backend failed the run
 * ("Service unavailable" on Cursor's side) and the SDK stream only carried a bare
 * `status: CANCELLED` with no message. The service used to persist a quiet status
 * line and never emitted `app:error`, so nothing surfaced in the chat UI. The
 * classifier returns the transcript copy and whether the user must be notified,
 * keeping deliberate user stops quiet.
 */

import { parseUsageLimitResetMs } from '../../lib/usage-limit.js';

export type CursorTerminalStatus = 'ERROR' | 'CANCELLED' | 'EXPIRED';

/** Cursor reported a plan/usage limit; `resetAtMs` is parsed from its text when present. */
export type CursorUsageLimit = { resetAtMs: number | null };

const CURSOR_USAGE_LIMIT_PATTERN =
  /usage limit|rate limit|quota|spend limit|limit (?:reached|exceeded)|exceeded .*limit|too many requests|\b429\b/i;

/**
 * Detect a Cursor usage/rate limit from an SDK error or terminal-status detail.
 * Cursor exposes no structured reset time, so it is parsed from the text (null when absent).
 */
export function cursorUsageLimit(
  source: { name?: string; status?: number; message?: string } | string | null | undefined,
  nowMs = Date.now()
): CursorUsageLimit | null {
  if (!source) return null;
  const text = typeof source === 'string' ? source : (source.message ?? '');
  const structured =
    typeof source !== 'string' && (source.name === 'RateLimitError' || source.status === 429);
  if (!structured && !CURSOR_USAGE_LIMIT_PATTERN.test(text)) return null;
  return { resetAtMs: parseUsageLimitResetMs(text, nowMs) };
}

export type CursorTerminalSurfacingInput = {
  /** Cursor's own error text (`SDKStatusMessage.message` / run-handle detail), when present. */
  detail?: string | null;
  /** True when Baguette's own stop path (stopTurn / sessions stop) started this. */
  userInitiated?: boolean;
};

export type CursorTerminalSurfacing = {
  /** Copy for the persisted `turn_result` error (or a quiet status row on user stop). */
  statusText: string;
  /** True when the run failed without the user asking for it (emit `app:error`). */
  isFailure: boolean;
  /** Set when the failure is a usage limit: stop or wait per the session's usage limit action. */
  usageLimit?: CursorUsageLimit | null;
};

const RETRY_HINT = 'Send your message again to continue in a fresh conversation.';

/** Trim a detail and terminate the sentence so it never runs into the retry hint. */
function detailSentence(detail?: string | null): string | null {
  if (!detail) return null;
  const text = detail.trim();
  if (!text) return null;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function cursorTerminalStatusSurfacing(
  status: CursorTerminalStatus,
  { detail, userInitiated }: CursorTerminalSurfacingInput = {}
): CursorTerminalSurfacing {
  if (status === 'ERROR') {
    const usageLimit = cursorUsageLimit(detail);
    if (usageLimit) {
      return { statusText: `Cursor usage limit reached. ${detail}`, isFailure: true, usageLimit };
    }
    const sentence = detailSentence(detail);
    const detailText = sentence ? ` ${sentence}` : '';
    return {
      statusText: `Cursor agent encountered an error.${detailText} ${RETRY_HINT}`,
      isFailure: true,
    };
  }
  if (status === 'EXPIRED') {
    return {
      statusText: `Cursor agent conversation expired. ${RETRY_HINT}`,
      isFailure: true,
    };
  }

  // CANCELLED: a user stop is benign — nothing failed and the indicator state is
  // already handled by the stop path; a remote/platform cancel is a failure.
  if (userInitiated) {
    return {
      statusText: 'Cursor agent was cancelled.',
      isFailure: false,
    };
  }
  const reasonSentence = detailSentence(detail);
  const reason = reasonSentence
    ? ` Cursor reported: ${reasonSentence}`
    : ' Cursor did not report a reason.';
  return {
    statusText: `Cursor agent was stopped unexpectedly.${reason} ${RETRY_HINT}`,
    isFailure: true,
  };
}

/**
 * Copy for a run whose stream drained without any terminal status event. Kept next to
 * the classifier so its detail punctuation follows the same rules.
 */
export function cursorSilentEndStatusText(detail?: string | null): string {
  const sentence = detailSentence(detail);
  const detailText = sentence ? ` ${sentence}` : '';
  return `Cursor agent ended the run without completing.${detailText} ${RETRY_HINT}`;
}
