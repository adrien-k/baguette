export const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

export const INTERVAL_PRESETS = [
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 120, label: 'Every 2 hours' },
  { value: 240, label: 'Every 4 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Every day' },
  { value: 10080, label: 'Every week' },
];

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Recurrence a brand-new loop starts from, or the stored one when editing. */
export function scheduleFromLoop(loop) {
  return {
    schedule_type: loop?.schedule_type ?? 'interval',
    interval_minutes: Number(loop?.interval_minutes) || 240,
    time_of_day: loop?.time_of_day ?? '09:00',
    days_of_week:
      Array.isArray(loop?.days_of_week) && loop.days_of_week.length
        ? loop.days_of_week
        : [1, 2, 3, 4, 5],
    timezone: loop?.timezone || browserTimezone(),
  };
}

/** The fields the server actually stores for this recurrence, with the unused ones nulled. */
export function schedulePayload(schedule) {
  const isInterval = schedule.schedule_type === 'interval';
  return {
    schedule_type: schedule.schedule_type,
    interval_minutes: isInterval ? schedule.interval_minutes : null,
    time_of_day: isInterval ? null : schedule.time_of_day,
    days_of_week:
      schedule.schedule_type === 'weekly' ? [...schedule.days_of_week].sort((a, b) => a - b) : null,
    timezone: schedule.timezone,
  };
}

export function isScheduleComplete(schedule) {
  if (schedule.schedule_type === 'interval') return !!schedule.interval_minutes;
  if (!schedule.time_of_day) return false;
  return schedule.schedule_type !== 'weekly' || schedule.days_of_week.length > 0;
}

function formatInterval(minutes) {
  const preset = INTERVAL_PRESETS.find((p) => p.value === minutes);
  if (preset) return preset.label.toLowerCase();
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `every ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `every ${minutes} minutes`;
}

/** Human summary of a loop's recurrence, e.g. "Every 2 hours" or "Mon, Wed at 09:00 (UTC)". */
export function describeSchedule(loop) {
  if (!loop?.schedule_type) return '';
  if (loop.schedule_type === 'interval') {
    const text = formatInterval(Number(loop.interval_minutes));
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const tz = loop.timezone && loop.timezone !== 'UTC' ? ` (${loop.timezone})` : ' (UTC)';
  if (loop.schedule_type === 'daily') return `Daily at ${loop.time_of_day}${tz}`;
  const days = Array.isArray(loop.days_of_week) ? loop.days_of_week : [];
  const labels = WEEKDAYS.filter((d) => days.includes(d.value)).map((d) => d.label);
  return `${labels.join(', ') || 'No day'} at ${loop.time_of_day}${tz}`;
}

/** Short "in 3h" style countdown for the next scheduled run. */
export function formatCountdown(isoString) {
  if (!isoString) return '';
  const diff = new Date(isoString) - new Date();
  if (diff <= 0) return 'due now';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
