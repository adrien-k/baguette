import { formatDateTimeWithZone } from './dates.js';

/** Whole dollars when exact ("$800"), otherwise cents ("$13.98"). */
function formatDollars(value) {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** "in 25m", "in 4h 31m", "in 5d 22h" — time until `ms` from now. */
function formatCountdown(ms) {
  if (ms < DAY_MS) {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `in ${hours}h ${minutes % 60}m` : `in ${minutes}m`;
  }
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  return hours > 0 ? `in ${days}d ${hours}h` : `in ${days}d`;
}

/** "resets in 4h 31m (Nov 18, 9:10 PM UTC+1)" — countdown plus the absolute local time. */
export function formatLimitReset(iso, now = Date.now()) {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const ms = at - now;
  if (ms <= 0) return 'resets now';
  return `resets ${formatCountdown(ms)} (${formatDateTimeWithZone(at)})`;
}

/** Detail line under a bar: "$1.60 of $20 · resets in 17d (Dec 6, 1:00 AM UTC+1)". */
export function limitDetail(limit, now = Date.now()) {
  // A note on a row without a value replaces the detail; on a row with one it is appended.
  if (limit.note && limit.percent == null && limit.used_usd == null) return limit.note;
  const parts = [];
  // The overage row already shows "$used / $limit" on the right; only the reset is left here.
  if (limit.id !== 'overage' && limit.used_usd != null && limit.limit_usd != null) {
    parts.push(`${formatDollars(limit.used_usd)} of ${formatDollars(limit.limit_usd)}`);
  }
  const reset = formatLimitReset(limit.resets_at, now);
  if (reset) parts.push(reset);
  if (limit.note) parts.push(limit.note);
  return parts.join(' · ');
}

/** Account pieces shown beside the provider title: name, login email and plan ("pro" → "Pro"). */
export function accountParts(account) {
  if (!account) return [];
  const plan = account.plan ? account.plan.charAt(0).toUpperCase() + account.plan.slice(1) : null;
  return [account.name, account.email, plan].filter(Boolean);
}

export function limitPercentLabel(percent) {
  if (percent == null) return '—';
  return `${Math.round(percent)}%`;
}

/** Right-hand value of a row: percent for windows, "$0 / Unlimited" or "$0 / $800" for overage. */
export function limitValueLabel(limit) {
  if (limit.id === 'overage' && limit.used_usd != null) {
    const cap = limit.limit_usd != null ? formatDollars(limit.limit_usd) : 'Unlimited';
    return `${formatDollars(limit.used_usd)} / ${cap}`;
  }
  if (limit.percent == null && limit.note) return '';
  return limitPercentLabel(limit.percent);
}

/** Bar colour by how close the limit is. */
export function limitBarClass(percent) {
  if (percent != null && percent >= 90) return 'bg-red-500';
  if (percent != null && percent >= 75) return 'bg-warning';
  return 'bg-success';
}
