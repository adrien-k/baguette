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

export type CursorTerminalStatus = 'ERROR' | 'CANCELLED' | 'EXPIRED';

export type CursorTerminalSurfacingInput = {
  /** Cursor's own error text (`SDKStatusMessage.message` / run-handle detail), when present. */
  detail?: string | null;
  /** True when Baguette's own stop path (stopTurn / sessions stop) started this. */
  userInitiated?: boolean;
};

export type CursorTerminalSurfacing = {
  /** Copy for the persisted `system/status` transcript row. */
  statusText: string;
  /** True when the run failed without the user asking for it (emit `app:error`). */
  isFailure: boolean;
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
