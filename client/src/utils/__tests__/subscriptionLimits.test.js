import { describe, it, expect } from 'vitest';
import {
  accountParts,
  formatLimitReset,
  limitBarClass,
  limitDetail,
  limitPercentLabel,
  limitValueLabel,
} from '../subscriptionLimits.js';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const at = (ms) => new Date(NOW + ms).toISOString();
const HOUR = 3_600_000;

describe('formatLimitReset', () => {
  // "(Nov 18, 9:10 PM UTC+1)": date, time and the browser's UTC offset.
  const ABSOLUTE = String.raw`\([A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M UTC([+-]\d{1,2}(:\d{2})?)?\)$`;

  it('counts down within a day and adds the absolute time in brackets', () => {
    expect(formatLimitReset(at(4 * HOUR + 31 * 60_000), NOW)).toMatch(
      new RegExp(`^resets in 4h 31m ${ABSOLUTE}`)
    );
    expect(formatLimitReset(at(25 * 60_000), NOW)).toMatch(
      new RegExp(`^resets in 25m ${ABSOLUTE}`)
    );
  });

  it('counts days and hours for weekly-scale resets, also with the absolute time', () => {
    expect(formatLimitReset(at(5 * 24 * HOUR + 22 * HOUR), NOW)).toMatch(
      new RegExp(`^resets in 5d 22h ${ABSOLUTE}`)
    );
    expect(formatLimitReset(at(20 * 24 * HOUR), NOW)).toMatch(
      new RegExp(`^resets in 20d ${ABSOLUTE}`)
    );
  });

  it('handles past and missing values', () => {
    expect(formatLimitReset(at(-1000), NOW)).toBe('resets now');
    expect(formatLimitReset(null, NOW)).toBeNull();
    expect(formatLimitReset('nope', NOW)).toBeNull();
  });
});

describe('limitDetail', () => {
  it('shows spend against the limit and the reset', () => {
    expect(
      limitDetail(
        { id: 'included', used_usd: 1.6, limit_usd: 20, resets_at: at(20 * 24 * HOUR) },
        NOW
      )
    ).toMatch(/^\$1\.60 of \$20 · resets in 20d /);
    expect(
      limitDetail({ id: 'included', used_usd: 1.6, limit_usd: 20, resets_at: null }, NOW)
    ).toBe('$1.60 of $20');
  });

  it('leaves the amounts to the right-hand value on the overage row', () => {
    expect(
      limitDetail(
        { id: 'overage', used_usd: 0, limit_usd: 800, resets_at: at(20 * 24 * HOUR) },
        NOW
      )
    ).toMatch(/^resets in 20d /);
    expect(limitDetail({ id: 'overage', note: 'Not enabled' }, NOW)).toBe('Not enabled');
    expect(
      limitDetail(
        {
          id: 'overage',
          percent: 4,
          resets_at: new Date(NOW + 2 * 3600_000).toISOString(),
          note: 'Requires a full Claude login to show the limit in $',
        },
        NOW
      )
    ).toMatch(/^resets in 2h .* · Requires a full Claude login to show the limit in \$$/);
  });

  it('is just the reset for percent-only windows', () => {
    expect(limitDetail({ id: 'session', resets_at: at(HOUR) }, NOW)).toMatch(
      /^resets in 1h 0m \([A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M UTC([+-]\d{1,2}(:\d{2})?)?\)$/
    );
  });
});

describe('accountParts', () => {
  it('lists name, email and capitalised plan, skipping what is unknown', () => {
    expect(accountParts({ name: 'Claude', email: 'a@b.co', plan: 'pro' })).toEqual([
      'Claude',
      'a@b.co',
      'Pro',
    ]);
    expect(accountParts({ name: 'Claude', email: null, plan: null })).toEqual(['Claude']);
    expect(accountParts(null)).toEqual([]);
  });

  it('keeps only the known pieces, in name · email · plan order', () => {
    expect(accountParts({ name: 'Work', email: null, plan: 'max' })).toEqual(['Work', 'Max']);
    expect(accountParts({ email: 'a@b.co' })).toEqual(['a@b.co']);
  });
});

describe('limitValueLabel', () => {
  it('shows "$used / Unlimited" or "$used / $limit" for overage, percent otherwise', () => {
    expect(limitValueLabel({ id: 'overage', used_usd: 0, limit_usd: null })).toBe('$0 / Unlimited');
    expect(limitValueLabel({ id: 'overage', used_usd: 13.98, limit_usd: 800 })).toBe(
      '$13.98 / $800'
    );
    expect(limitValueLabel({ id: 'session', percent: 41.4 })).toBe('41%');
    expect(limitValueLabel({ id: 'overage', note: 'Not enabled', percent: null })).toBe('');
  });
});

describe('percent helpers', () => {
  it('formats and colours', () => {
    expect(limitPercentLabel(41.4)).toBe('41%');
    expect(limitPercentLabel(null)).toBe('—');
    expect(limitBarClass(10)).toBe('bg-success');
    expect(limitBarClass(80)).toBe('bg-warning');
    expect(limitBarClass(95)).toBe('bg-red-500');
  });
});
