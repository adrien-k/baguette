import { describe, it, expect } from 'vitest';
import {
  allowsOverage,
  computeResumeAtMs,
  FALLBACK_RETRY_MAX_MS,
  FALLBACK_RETRY_MS,
  fallbackRetryMs,
  isUsageLimitText,
  parseUsageLimitResetMs,
  RESUME_MARGIN_MAX_MS,
  RESUME_MARGIN_MIN_MS,
  usageLimitFieldsError,
  usageLimitStatusText,
} from '../usage-limit.js';

const NOW = Date.parse('2026-11-18T12:00:00Z');

describe('parseUsageLimitResetMs', () => {
  it('reads ISO timestamps', () => {
    expect(parseUsageLimitResetMs('Limit resets at 2026-11-18T15:30:00Z', NOW)).toBe(
      Date.parse('2026-11-18T15:30:00Z')
    );
  });

  it('reads "YYYY-MM-DD HH:mm UTC" copy', () => {
    expect(parseUsageLimitResetMs('resets 2026-11-19 03:00 UTC', NOW)).toBe(
      Date.parse('2026-11-19T03:00:00Z')
    );
  });

  it('reads relative durations', () => {
    expect(parseUsageLimitResetMs('Try again in 2 hours 5 minutes', NOW)).toBe(
      NOW + 2 * 3_600_000 + 5 * 60_000
    );
    expect(parseUsageLimitResetMs('Retry after 90 seconds', NOW)).toBe(NOW + 90_000);
  });

  it('ignores past timestamps and unrelated text', () => {
    expect(parseUsageLimitResetMs('resets 2020-01-01T00:00:00Z', NOW)).toBeNull();
    expect(parseUsageLimitResetMs('Too many requests', NOW)).toBeNull();
    expect(parseUsageLimitResetMs(null, NOW)).toBeNull();
  });
});

describe('computeResumeAtMs', () => {
  it('adds a 1-2 minute margin after the reset', () => {
    const reset = NOW + 3_600_000;
    const low = computeResumeAtMs(reset, NOW, () => 0);
    const high = computeResumeAtMs(reset, NOW, () => 0.999999);
    expect(low).toBe(reset + RESUME_MARGIN_MIN_MS);
    expect(high).toBeGreaterThan(reset + RESUME_MARGIN_MIN_MS);
    expect(high).toBeLessThan(reset + RESUME_MARGIN_MAX_MS);
  });

  it('falls back to a retry delay when the reset is unknown or past', () => {
    expect(computeResumeAtMs(null, NOW, () => 0)).toBe(
      NOW + FALLBACK_RETRY_MS + RESUME_MARGIN_MIN_MS
    );
    expect(computeResumeAtMs(NOW - 1000, NOW, () => 0)).toBe(
      NOW + FALLBACK_RETRY_MS + RESUME_MARGIN_MIN_MS
    );
  });
});

describe('usage limit action + copy', () => {
  it('words stop and wait differently', () => {
    const base = {
      label: 'Claude',
      reason: 'rejected',
      resetAtMs: NOW + 1000,
    };
    expect(usageLimitStatusText({ ...base, action: 'stop' })).toContain('Session stopped');
    expect(usageLimitStatusText({ ...base, action: 'wait' })).toBe(
      'Claude usage limit reached. Waiting for reset.'
    );
    expect(usageLimitStatusText({ ...base, action: 'stop', reason: 'usage_limit' })).toContain(
      'session usage limit reached'
    );
  });
});

describe('allowsOverage', () => {
  it('only continue may spend credits', () => {
    expect(allowsOverage('continue')).toBe(true);
    expect(allowsOverage('wait')).toBe(false);
    expect(allowsOverage('stop')).toBe(false);
  });
});

describe('usageLimitFieldsError', () => {
  it('accepts known actions and normalizes usage_limit (null = unlimited)', () => {
    for (const [input, expected] of [
      ['', null],
      [null, null],
      ['0.25', 0.25],
      [0, 0],
      [5, 5],
    ]) {
      const data = { usage_limit_action: 'continue', usage_limit: input };
      expect(usageLimitFieldsError(data)).toBeNull();
      expect(data.usage_limit).toBe(expected);
    }
    expect(usageLimitFieldsError({})).toBeNull();
  });

  it('rejects unknown actions and invalid limits', () => {
    expect(usageLimitFieldsError({ usage_limit_action: 'pause' })).toMatch(/usage_limit_action/);
    for (const bad of [-1, 'abc', NaN, Infinity]) {
      expect(usageLimitFieldsError({ usage_limit: bad })).toMatch(/usage_limit must be/);
    }
  });
});

describe('fallbackRetryMs', () => {
  it('backs off 30m, 1h, 2h, 4h and caps at 6h', () => {
    expect([0, 1, 2, 3, 4, 9].map(fallbackRetryMs)).toEqual([
      FALLBACK_RETRY_MS,
      2 * FALLBACK_RETRY_MS,
      4 * FALLBACK_RETRY_MS,
      8 * FALLBACK_RETRY_MS,
      FALLBACK_RETRY_MAX_MS,
      FALLBACK_RETRY_MAX_MS,
    ]);
  });

  it('computeResumeAtMs uses the attempt when the reset is unknown', () => {
    const at = computeResumeAtMs(null, NOW, () => 0, 2);
    expect(at).toBe(NOW + 4 * FALLBACK_RETRY_MS + RESUME_MARGIN_MIN_MS);
  });
});

describe('isUsageLimitText', () => {
  it('matches plan-limit wording only, not generic rate-limit text', () => {
    expect(isUsageLimitText('You have hit your usage limit')).toBe(true);
    expect(isUsageLimitText('Claude AI usage limit reached|1700000000')).toBe(true);
    expect(
      isUsageLimitText(
        "API Error: Request rejected (429) · This request would exceed your account's rate limit. Please try again later."
      )
    ).toBe(true);
    expect(isUsageLimitText('rate limit, slow down')).toBe(false);
    expect(isUsageLimitText('quota check failed, too many requests (429)')).toBe(false);
    expect(isUsageLimitText(undefined)).toBe(false);
  });
});

describe('usageLimitFieldsError null action', () => {
  it('drops a null usage_limit_action so the column default applies', () => {
    const data = { usage_limit_action: null };
    expect(usageLimitFieldsError(data)).toBeNull();
    expect('usage_limit_action' in data).toBe(false);
  });
});
