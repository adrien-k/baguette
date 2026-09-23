/**
 * Recurrence maths for loops.
 *
 * Pure functions: no DB and no implicit clock — the caller passes the reference instant. Daily
 * and weekly schedules are wall-clock in the loop's IANA timezone, so a "09:00" loop keeps
 * firing at 09:00 local across DST changes; interval schedules are plain elapsed time.
 */

export const SCHEDULE_TYPES = ['interval', 'daily', 'weekly'];
export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 60 * 24 * 30;

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Calendar parts of `ts` as read on a wall clock in `timeZone`. */
function partsInZone(ts, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(ts));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_INDEX[map.weekday],
  };
}

/** Offset (ms) to add to a UTC instant to get the zone's wall-clock reading of it. */
function zoneOffsetMs(ts, timeZone) {
  const p = partsInZone(ts, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts;
}

/**
 * UTC instant for a wall-clock date/time in `timeZone`. The offset is resolved iteratively
 * because the offset itself depends on the instant we are solving for (DST boundaries).
 */
function zonedToUtcMs({ year, month, day, hour, minute }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstGuess = naive - zoneOffsetMs(naive, timeZone);
  return naive - zoneOffsetMs(firstGuess, timeZone);
}

/**
 * Validate and canonicalise a schedule. Throws `Error` with a user-facing message when the
 * recurrence is not usable; callers at the API boundary wrap that in a BadRequest.
 */
export function normalizeSchedule(input) {
  const type = input?.type ?? input?.schedule_type;
  if (!SCHEDULE_TYPES.includes(type)) {
    throw new Error(`schedule_type must be one of: ${SCHEDULE_TYPES.join(', ')}`);
  }
  const timezone = isValidTimezone(input?.timezone) ? input.timezone : 'UTC';

  if (type === 'interval') {
    const minutes = Number(input?.interval_minutes);
    if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
      throw new Error('interval_minutes must be an integer');
    }
    if (minutes < MIN_INTERVAL_MINUTES) {
      throw new Error(`interval_minutes must be at least ${MIN_INTERVAL_MINUTES}`);
    }
    if (minutes > MAX_INTERVAL_MINUTES) {
      throw new Error(`interval_minutes must be at most ${MAX_INTERVAL_MINUTES}`);
    }
    return {
      type,
      interval_minutes: minutes,
      time_of_day: null,
      days_of_week: null,
      timezone,
    };
  }

  const timeOfDay = input?.time_of_day;
  if (typeof timeOfDay !== 'string' || !TIME_OF_DAY_RE.test(timeOfDay)) {
    throw new Error('time_of_day must be a HH:MM time between 00:00 and 23:59');
  }

  if (type === 'daily') {
    return {
      type,
      interval_minutes: null,
      time_of_day: timeOfDay,
      days_of_week: null,
      timezone,
    };
  }

  const rawDays = Array.isArray(input?.days_of_week)
    ? input.days_of_week
    : parseDaysOfWeek(input?.days_of_week);
  const days = [...new Set((rawDays ?? []).map(Number))].sort((a, b) => a - b);
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error('days_of_week must contain at least one day index between 0 (Sun) and 6 (Sat)');
  }
  return {
    type,
    interval_minutes: null,
    time_of_day: timeOfDay,
    days_of_week: days,
    timezone,
  };
}

/** Read a `days_of_week` DB column (JSON text) back into an array. */
export function parseDaysOfWeek(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The schedule half of a loop row, in the shape `normalizeSchedule` accepts. */
export function scheduleFromLoop(loop) {
  return {
    type: loop.schedule_type,
    interval_minutes: loop.interval_minutes,
    time_of_day: loop.time_of_day,
    days_of_week: parseDaysOfWeek(loop.days_of_week),
    timezone: loop.timezone,
  };
}

/**
 * Next firing instant strictly after `fromMs`, as an ISO string.
 * Returns null when no occurrence exists within the next week (only reachable if a weekly
 * schedule somehow carries no valid day).
 */
export function computeNextRun(schedule, fromMs = Date.now()) {
  const s = normalizeSchedule(schedule);
  if (s.type === 'interval') {
    return new Date(fromMs + s.interval_minutes * 60_000).toISOString();
  }

  const [hour, minute] = s.time_of_day.split(':').map(Number);
  const today = partsInZone(fromMs, s.timezone);
  // Walk local calendar days; 8 covers "later today" plus a full week for weekly schedules.
  for (let i = 0; i <= 8; i++) {
    const cursor = new Date(Date.UTC(today.year, today.month - 1, today.day) + i * DAY_MS);
    const ts = zonedToUtcMs(
      {
        year: cursor.getUTCFullYear(),
        month: cursor.getUTCMonth() + 1,
        day: cursor.getUTCDate(),
        hour,
        minute,
      },
      s.timezone
    );
    if (ts <= fromMs) continue;
    // Check the weekday of the resolved instant, not of the candidate date: a time that does
    // not exist locally (spring-forward) is shifted and could land on another day.
    if (s.type === 'weekly' && !s.days_of_week.includes(partsInZone(ts, s.timezone).weekday)) {
      continue;
    }
    return new Date(ts).toISOString();
  }
  return null;
}
