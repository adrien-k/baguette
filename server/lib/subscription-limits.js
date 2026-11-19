import logger from '../logger.js';

/**
 * Provider-agnostic subscription-limit results (Claude 5h/weekly/spend, Cursor included usage).
 *
 * Each SDK plugin exposes `fetchSubscriptionLimits(ctx)` returning a result built with the
 * helpers below; `usage.subscriptionLimits` caches results per user + SDK so opening the
 * session page does not spawn a fetch every time ("Sync now" forces a refresh).
 */

/** Just under the card's 60s auto-refresh, so every poll reads fresh data while tabs share one fetch. */
export const SUBSCRIPTION_LIMITS_TTL_MS = 55_000;
const ERROR_TTL_MS = 60_000;

/**
 * @typedef {{ id: string, label: string, percent: number | null, resets_at: string | null,
 *   used_usd: number | null, limit_usd: number | null }} SubscriptionLimit
 */

/** @returns {SubscriptionLimit} */
export function subscriptionLimit({
  id,
  label,
  percent = null,
  resetsAt = null,
  usedUsd = null,
  limitUsd = null,
  note = null,
}) {
  const clamped = percent == null || Number.isNaN(percent) ? null : clampPercent(percent);
  return {
    id,
    label,
    percent: clamped,
    resets_at: resetsAt,
    used_usd: usedUsd,
    limit_usd: limitUsd,
    note,
  };
}

/** Percent of `limit` consumed by `used`; null when there is no positive limit. */
export function percentOf(used, limit) {
  return limit > 0 ? (used / limit) * 100 : null;
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

/**
 * `account` is whatever the provider can tell us about the login (`{ email, plan }`, any
 * field optional). The usage service adds the agent config's name on top.
 */
export function subscriptionResult(status, { limits = [], message = null, account = null } = {}) {
  return { status, message, limits, account };
}

const cache = new Map();
/** Fetches already running per key, so overlapping polls / tabs share one provider call. */
const inflight = new Map();

/**
 * Cached provider result. A failing fetch becomes an `error` result (cached briefly) rather
 * than throwing, so one broken provider never blanks the whole card.
 */
export function getCachedSubscriptionLimits(
  key,
  fetcher,
  { refresh = false, now = Date.now } = {}
) {
  const hit = cache.get(key);
  if (!refresh && hit && hit.expiresAt > now()) return Promise.resolve(hit.value);
  const running = inflight.get(key);
  if (running) return running;

  const run = (async () => {
    let result;
    let ttl = SUBSCRIPTION_LIMITS_TTL_MS;
    try {
      result = await fetcher();
    } catch (err) {
      logger.warn({ key, err: err?.message }, 'subscription limits: provider fetch failed');
      result = subscriptionResult('error', { message: err?.message || 'Failed to load limits' });
      ttl = ERROR_TTL_MS;
    }
    const value = { ...result, refreshed_at: new Date(now()).toISOString() };
    cache.set(key, { value, expiresAt: now() + ttl });
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

export function clearSubscriptionLimitsCache() {
  cache.clear();
  inflight.clear();
}
