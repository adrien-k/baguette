import { describe, expect, it } from 'vitest';
import {
  formatMessageDateTimeTooltip,
  formatMessageTime,
  formatMonthDayTime,
  formatRelativeTime,
} from '../dates.js';

describe('formatMessageTime', () => {
  const iso = '2026-03-15T14:30:00.000Z';

  it('returns a short time string', () => {
    const result = formatMessageTime(iso);
    expect(result).toMatch(/\d/);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty string for invalid input', () => {
    expect(formatMessageTime(null)).toBe('');
    expect(formatMessageTime('')).toBe('');
  });
});

describe('formatMessageDateTimeTooltip', () => {
  const iso = '2026-03-15T14:30:00.000Z';

  it('includes year and month', () => {
    const result = formatMessageDateTimeTooltip(iso);
    expect(result).toContain('2026');
    expect(result).toMatch(/Mar|3/);
  });
});

describe('formatMonthDayTime', () => {
  it('returns month and day without year', () => {
    const result = formatMonthDayTime('2026-03-15T14:30:00.000Z');
    expect(result).toMatch(/Mar|3/);
    expect(result).not.toContain('2026');
  });
});

describe('formatRelativeTime', () => {
  it('returns just now for recent timestamps', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('just now');
  });
});
