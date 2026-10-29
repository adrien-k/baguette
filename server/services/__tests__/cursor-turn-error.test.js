/**
 * Terminal Cursor statuses must turn into user-visible failure surfacing.
 *
 * Session 922 regression: Cursor's backend killed the run ("Service unavailable")
 * and the SDK stream delivered only a bare `status: CANCELLED` with no message.
 * The old code persisted a quiet status line ("Cursor agent was cancelled.") and
 * never fired `app:error`, so the failure never reached the user. The classifier
 * in `cursor-turn-error.ts` decides the transcript copy and whether the failure
 * must bubble up — user-initiated stops stay quiet, everything else surfaces.
 */
import { describe, it, expect } from 'vitest';
import {
  cursorSilentEndStatusText,
  cursorTerminalStatusSurfacing,
} from '../cursor/cursor-turn-error.ts';

const RETRY_HINT = 'Send your message again to continue in a fresh conversation.';

describe('cursorTerminalStatusSurfacing', () => {
  it('surfaces ERROR with Cursor’s detail text as a failure', () => {
    const result = cursorTerminalStatusSurfacing('ERROR', {
      detail: 'HTTP 503 Service unavailable',
    });
    expect(result.isFailure).toBe(true);
    expect(result.statusText).toBe(
      `Cursor agent encountered an error. HTTP 503 Service unavailable. ${RETRY_HINT}`
    );
  });

  it('keeps sentence detail as-is without doubling punctuation', () => {
    const result = cursorTerminalStatusSurfacing('ERROR', {
      detail: 'Model gateway rejected the run.',
    });
    expect(result.statusText).toBe(
      `Cursor agent encountered an error. Model gateway rejected the run. ${RETRY_HINT}`
    );
  });

  it('surfaces ERROR without a detail as a failure with a retry hint', () => {
    const result = cursorTerminalStatusSurfacing('ERROR');
    expect(result.isFailure).toBe(true);
    expect(result.statusText).toBe(`Cursor agent encountered an error. ${RETRY_HINT}`);
  });

  it('surfaces EXPIRED as a failure', () => {
    const result = cursorTerminalStatusSurfacing('EXPIRED');
    expect(result.isFailure).toBe(true);
    expect(result.statusText).toBe(`Cursor agent conversation expired. ${RETRY_HINT}`);
  });

  it('treats CANCELLED after a user stop as benign (no app:error path)', () => {
    const result = cursorTerminalStatusSurfacing('CANCELLED', { userInitiated: true });
    expect(result.isFailure).toBe(false);
    expect(result.statusText).toBe('Cursor agent was cancelled.');
  });

  it('treats a remote CANCELLED without a reason as a failure (session 922 case)', () => {
    const result = cursorTerminalStatusSurfacing('CANCELLED', { userInitiated: false });
    expect(result.isFailure).toBe(true);
    expect(result.statusText).toBe(
      `Cursor agent was stopped unexpectedly. Cursor did not report a reason. ${RETRY_HINT}`
    );
  });

  it('names the remote CANCELLED reason when the run handle carries it', () => {
    const result = cursorTerminalStatusSurfacing('CANCELLED', {
      detail: 'Service unavailable',
      userInitiated: false,
    });
    expect(result.isFailure).toBe(true);
    expect(result.statusText).toBe(
      `Cursor agent was stopped unexpectedly. Cursor reported: Service unavailable. ${RETRY_HINT}`
    );
  });
});

describe('cursorSilentEndStatusText', () => {
  it('asks the user to retry without a detail', () => {
    expect(cursorSilentEndStatusText()).toBe(
      `Cursor agent ended the run without completing. ${RETRY_HINT}`
    );
  });

  it('includes the run-handle detail with sentence punctuation', () => {
    expect(cursorSilentEndStatusText('upstream fetch failed')).toBe(
      `Cursor agent ended the run without completing. upstream fetch failed. ${RETRY_HINT}`
    );
  });
});
