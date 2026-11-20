// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import UsageLimitNotice, { isUsageLimitStatus, splitUsageLimitHint } from '../UsageLimitNotice.tsx';

const STOPPED =
  'Claude usage limit reached. Session stopped. Limit resets 2026-11-19T21:30:00.000Z. ' +
  'To keep going now on paid overage credits, change "Details > When a usage limit is reached" to "Continue".';

afterEach(cleanup);

describe('usage limit notice', () => {
  it('recognizes the stop and wait notices, not ordinary status rows', () => {
    expect(isUsageLimitStatus(STOPPED)).toBe(true);
    expect(isUsageLimitStatus('Claude usage limit reached. Waiting for reset.')).toBe(true);
    expect(
      isUsageLimitStatus('Claude usage limit reached, continuing using overage credits.')
    ).toBe(true);
    expect(isUsageLimitStatus('Syncing with remote')).toBe(false);
  });

  it('splits the Continue hint from the main message', () => {
    const { message, hint } = splitUsageLimitHint(STOPPED);
    expect(message).toBe(
      'Claude usage limit reached. Session stopped. Limit resets 2026-11-19T21:30:00.000Z.'
    );
    expect(hint).toMatch(/^To keep going now/);
    expect(splitUsageLimitHint('Waiting for reset.').hint).toBeNull();
  });

  it('renders a stop notice as a warning with the time left, local reset time and hint', () => {
    const resetAt = new Date(Date.now() + 90 * 60_000).toISOString();
    render(
      <UsageLimitNotice
        status={`Claude usage limit reached. Session stopped. Limit resets ${resetAt}. To keep going now on paid overage credits, change "Details > When a usage limit is reached" to "Continue".`}
      />
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toContain(resetAt);
    expect(alert.textContent).toMatch(/\d{1,2}:\d{2} [AP]M UTC([+-]\d+(:\d{2})?)?/);
    expect(alert.textContent).toMatch(/1h (29|30)m( \d+s)?$/);
    expect(alert.textContent).toMatch(/resume the stopped session after the reset/);
    // The Continue hint is a note under the alert, not inside it.
    expect(alert.textContent).not.toMatch(/To keep going now/);
    expect(screen.getByText(/^Hint: To keep going now/)).toBeTruthy();
    expect(alert.parentElement?.contains(screen.getByText(/To keep going now/))).toBe(true);
  });
});

describe('wait notice', () => {
  it('says the session resumes automatically', () => {
    render(
      <UsageLimitNotice
        status="Claude usage limit reached. Waiting for reset."
        resumeAt={new Date(Date.now() + 60_000).toISOString()}
      />
    );
    expect(screen.getByRole('alert').textContent).toMatch(/automatically resumes the work/);
  });
});

describe('continue notice', () => {
  it('only says it is continuing on overage credits', () => {
    render(
      <UsageLimitNotice status="Claude usage limit reached, continuing using overage credits." />
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Claude usage limit reached, continuing using overage credits.');
  });
});

describe('wait notice after the countdown', () => {
  afterEach(() => vi.useRealTimers());

  it('shows Resuming… for 10s after the resume time, then Resumed', () => {
    vi.useFakeTimers();
    const resumeAt = new Date(Date.now() + 5_000).toISOString();
    render(
      <UsageLimitNotice
        status="Claude usage limit reached. Waiting for reset."
        resumeAt={resumeAt}
      />
    );
    expect(screen.getByRole('alert').textContent).toMatch(/5s$/);
    act(() => void vi.advanceTimersByTime(9_000));
    expect(screen.getByRole('alert').textContent).toMatch(/Resuming…$/);
    act(() => void vi.advanceTimersByTime(7_000));
    expect(screen.getByRole('alert').textContent).toMatch(/Resumed$/);
  });
});
