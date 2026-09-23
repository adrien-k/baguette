import { describe, it, expect } from 'vitest';
import { computeNextRun, normalizeSchedule, parseDaysOfWeek } from '../loop-schedule.js';

const at = (iso) => new Date(iso).getTime();

describe('normalizeSchedule', () => {
  it('rejects unknown schedule types', () => {
    expect(() => normalizeSchedule({ type: 'hourly' })).toThrow(/schedule_type/);
  });

  it('enforces the minimum interval', () => {
    expect(() => normalizeSchedule({ type: 'interval', interval_minutes: 5 })).toThrow(/at least/);
  });

  it('rejects malformed times', () => {
    expect(() => normalizeSchedule({ type: 'daily', time_of_day: '25:00' })).toThrow(/time_of_day/);
    expect(() => normalizeSchedule({ type: 'daily', time_of_day: '9:00' })).toThrow(/time_of_day/);
  });

  it('requires at least one valid weekday for weekly schedules', () => {
    expect(() =>
      normalizeSchedule({ type: 'weekly', time_of_day: '09:00', days_of_week: [] })
    ).toThrow(/days_of_week/);
    expect(() =>
      normalizeSchedule({ type: 'weekly', time_of_day: '09:00', days_of_week: [7] })
    ).toThrow(/days_of_week/);
  });

  it('deduplicates and sorts weekdays, and accepts JSON-encoded days', () => {
    const s = normalizeSchedule({
      type: 'weekly',
      time_of_day: '09:00',
      days_of_week: '[5,1,1]',
      timezone: 'Europe/Paris',
    });
    expect(s.days_of_week).toEqual([1, 5]);
    expect(s.timezone).toBe('Europe/Paris');
  });

  it('falls back to UTC for an unusable timezone', () => {
    const s = normalizeSchedule({ type: 'daily', time_of_day: '09:00', timezone: 'Mars/Olympus' });
    expect(s.timezone).toBe('UTC');
  });

  it('clears the fields that do not apply to the chosen type', () => {
    const s = normalizeSchedule({
      type: 'interval',
      interval_minutes: 60,
      time_of_day: '09:00',
      days_of_week: [1],
    });
    expect(s).toMatchObject({ time_of_day: null, days_of_week: null });
  });
});

describe('computeNextRun', () => {
  it('adds the interval for interval schedules', () => {
    const next = computeNextRun(
      { type: 'interval', interval_minutes: 90 },
      at('2026-03-01T10:00:00Z')
    );
    expect(next).toBe('2026-03-01T11:30:00.000Z');
  });

  it('picks today for a daily schedule that has not passed yet', () => {
    const next = computeNextRun(
      { type: 'daily', time_of_day: '09:00', timezone: 'UTC' },
      at('2026-03-01T07:00:00Z')
    );
    expect(next).toBe('2026-03-01T09:00:00.000Z');
  });

  it('rolls over to tomorrow once the daily time has passed', () => {
    const next = computeNextRun(
      { type: 'daily', time_of_day: '09:00', timezone: 'UTC' },
      at('2026-03-01T09:00:00Z')
    );
    expect(next).toBe('2026-03-02T09:00:00.000Z');
  });

  it('resolves the local wall-clock time in the loop timezone', () => {
    // 09:00 in Paris is 08:00 UTC in winter.
    const next = computeNextRun(
      { type: 'daily', time_of_day: '09:00', timezone: 'Europe/Paris' },
      at('2026-01-10T00:00:00Z')
    );
    expect(next).toBe('2026-01-10T08:00:00.000Z');
  });

  it('keeps the local time across a DST change', () => {
    // Paris moves to UTC+2 on 2026-03-29, so 09:00 local becomes 07:00 UTC.
    const next = computeNextRun(
      { type: 'daily', time_of_day: '09:00', timezone: 'Europe/Paris' },
      at('2026-03-29T00:00:00Z')
    );
    expect(next).toBe('2026-03-29T07:00:00.000Z');
  });

  it('skips to the next selected weekday for weekly schedules', () => {
    // 2026-03-01 is a Sunday; the next Wednesday is 2026-03-04.
    const next = computeNextRun(
      { type: 'weekly', time_of_day: '08:30', days_of_week: [3], timezone: 'UTC' },
      at('2026-03-01T12:00:00Z')
    );
    expect(next).toBe('2026-03-04T08:30:00.000Z');
  });

  it('fires later the same day when that weekday is selected', () => {
    // 2026-03-02 is a Monday.
    const next = computeNextRun(
      { type: 'weekly', time_of_day: '18:00', days_of_week: [1, 4], timezone: 'UTC' },
      at('2026-03-02T09:00:00Z')
    );
    expect(next).toBe('2026-03-02T18:00:00.000Z');
  });
});

describe('parseDaysOfWeek', () => {
  it('reads the JSON column and ignores junk', () => {
    expect(parseDaysOfWeek('[1,2]')).toEqual([1, 2]);
    expect(parseDaysOfWeek([3])).toEqual([3]);
    expect(parseDaysOfWeek('not json')).toBeNull();
    expect(parseDaysOfWeek(null)).toBeNull();
  });
});
