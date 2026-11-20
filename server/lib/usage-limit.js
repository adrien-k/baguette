/**
 * Shared helpers for subscription usage limits (Claude 5h/weekly, Cursor plan limits).
 *
 * Pure logic only: DB writes and scheduling live in the sessions Feathers service
 * (`onUsageLimit`); SDK-specific detection lives in each `agent-sdks/<sdk>/` folder.
 */

/**
 * What an agent does at a subscription limit:
 *  - `stop`     — stop work, no paid overage;
 *  - `wait`     — wait for the reset (+ margin), then continue, no paid overage;
 *  - `continue` — keep going on paid credits until the session's `usage_limit` (USD) is
 *                 spent (no limit when null), then stop.
 */
const USAGE_LIMIT_ACTIONS = ['stop', 'wait', 'continue'];

/**
 * Session `usage_limit` in USD: a finite number >= 0 (it may be a few cents), or null for
 * unlimited. Anything else (blank, negative, NaN) is not a valid limit.
 */
function normalizeUsageLimit(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Validate (and normalize in place) the `usage_limit_action` / `usage_limit` fields of a
 * session or loop write. Returns an error message, or null when the fields are fine.
 */
export function usageLimitFieldsError(data) {
  // `null` means "not set": drop it so the column default ('stop') applies instead of
  // tripping the NOT NULL constraint.
  if ('usage_limit_action' in data && data.usage_limit_action == null) {
    delete data.usage_limit_action;
  }
  if (data.usage_limit_action != null && !USAGE_LIMIT_ACTIONS.includes(data.usage_limit_action)) {
    return `usage_limit_action must be one of: ${USAGE_LIMIT_ACTIONS.join(', ')}`;
  }
  if ('usage_limit' in data) {
    const limit = normalizeUsageLimit(data.usage_limit);
    if (limit === undefined)
      return 'usage_limit must be a dollar amount >= 0, or empty for unlimited';
    data.usage_limit = limit;
  }
  return null;
}

/**
 * Before session/loop create: fill missing usage-limit fields from the user row
 * (Settings → Agent). Loop-spawned sessions skip — policy comes from the loop row.
 */
export async function applyUserDefaultUsageLimitsOnCreate(context) {
  if (context.method !== 'create') return context;
  if (context.data.loop_id != null) return context;
  const hasAction = 'usage_limit_action' in context.data;
  const hasLimit = 'usage_limit' in context.data;
  if (hasAction && hasLimit) return context;

  const userId = context.params?.user?.id ?? context.data?.user_id;
  if (userId == null) return context;

  const row = await context.app
    .get('db')('users')
    .where({ id: userId })
    .select('default_usage_limit_action', 'default_usage_limit')
    .first();
  if (!row?.default_usage_limit_action) return context;

  if (!hasAction) context.data.usage_limit_action = row.default_usage_limit_action;
  const action = context.data.usage_limit_action ?? row.default_usage_limit_action;
  if (!hasLimit && action === 'continue') {
    context.data.usage_limit = row.default_usage_limit ?? null;
  }
  return context;
}

/**
 * Validate `default_usage_limit_action` / `default_usage_limit` on users.patch (in place).
 */
export function userDefaultUsageLimitsPatchError(data) {
  if (data.default_usage_limit_action === undefined && data.default_usage_limit === undefined) {
    return null;
  }
  if (data.default_usage_limit_action === null) {
    data.default_usage_limit = null;
    return null;
  }
  const mapped = {
    usage_limit_action:
      data.default_usage_limit_action === undefined ? undefined : data.default_usage_limit_action,
    usage_limit: data.default_usage_limit === undefined ? undefined : data.default_usage_limit,
  };
  const error = usageLimitFieldsError(mapped);
  if (error) {
    return error
      .replaceAll('usage_limit_action', 'default_usage_limit_action')
      .replaceAll('usage_limit', 'default_usage_limit');
  }
  if (mapped.usage_limit_action !== undefined) {
    data.default_usage_limit_action = mapped.usage_limit_action ?? null;
  }
  if (mapped.usage_limit !== undefined) {
    data.default_usage_limit = mapped.usage_limit ?? null;
  }
  if (data.default_usage_limit_action != null && data.default_usage_limit_action !== 'continue') {
    data.default_usage_limit = null;
  }
  return null;
}

/** Only `continue` may spend paid overage. */
export function allowsOverage(action) {
  return action === 'continue';
}

/** Extra wait after the reported reset, so the window has really reopened. */
export const RESUME_MARGIN_MIN_MS = 60_000;
export const RESUME_MARGIN_MAX_MS = 120_000;

/** Retry delay when a provider reports a limit without a usable reset time. */
export const FALLBACK_RETRY_MS = 30 * 60_000;
/** Backoff ceiling, and how many resets-unknown retries `wait` makes before giving up. */
export const FALLBACK_RETRY_MAX_MS = 6 * 3_600_000;
export const MAX_UNKNOWN_RESET_RETRIES = 8;

/** 30m, 1h, 2h, 4h, then 6h: consecutive limit hits with no reset time back off. */
export function fallbackRetryMs(attempt = 0) {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(FALLBACK_RETRY_MS * 2 ** n, FALLBACK_RETRY_MAX_MS);
}

export const USAGE_LIMIT_RESUME_PROMPT =
  'The usage limit has reset. Continue the work where you left off.';

/**
 * Plan-limit wording shared by every SDK. Generic transient text ("rate limit", "quota",
 * "too many requests", a bare 429 in prose) is deliberately excluded: with `wait` it would
 * sleep for no reason and hide a normal failure. SDK-structured signals (Claude's rejected
 * rate-limit event, Cursor's `RateLimitError` / HTTP 429) are handled in each SDK folder.
 */
const USAGE_LIMIT_TEXT_PATTERN =
  /usage limit|spend limit|hit your limit|out of (?:usage|credits)|limit (?:reached|exceeded)|exceeded (?:your |the )?(?:\w+ )?limit|exceed your (?:account's )?rate limit/i;

export function isUsageLimitText(text) {
  return typeof text === 'string' && USAGE_LIMIT_TEXT_PATTERN.test(text);
}

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function unitMs(unit) {
  return UNIT_MS[unit[0].toLowerCase()];
}

/**
 * Best-effort reset time (epoch ms) from provider error text, or null.
 * Understands ISO timestamps ("resets at 2026-11-18T22:00:00Z"), relative copy
 * ("try again in 2 hours 5 minutes", "retry after 90 seconds").
 */
export function parseUsageLimitResetMs(text, nowMs = Date.now()) {
  if (!text || typeof text !== 'string') return null;

  const iso = text.match(
    /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z| ?UTC|[+-]\d{2}:?\d{2})?/
  );
  if (iso) {
    const normalized = iso[0].replace(' UTC', 'Z').replace(' ', 'T');
    const withZone = /(Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
    const ms = Date.parse(withZone);
    if (!Number.isNaN(ms) && ms > nowMs) return ms;
  }

  const relative = /(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;
  let total = 0;
  let found = false;
  for (const m of text.matchAll(relative)) {
    total += Number(m[1]) * unitMs(m[2]);
    found = true;
  }
  if (found && total > 0 && /\b(in|after|again)\b/i.test(text)) return nowMs + total;
  return null;
}

/** Epoch ms to send the resume message: reset (or fallback) plus a 1–2 minute margin. */
export function computeResumeAtMs(
  resetAtMs,
  nowMs = Date.now(),
  random = Math.random,
  attempt = 0
) {
  const base =
    resetAtMs != null && resetAtMs > nowMs ? resetAtMs : nowMs + fallbackRetryMs(attempt);
  const margin =
    RESUME_MARGIN_MIN_MS + Math.floor(random() * (RESUME_MARGIN_MAX_MS - RESUME_MARGIN_MIN_MS));
  return base + margin;
}

const USAGE_LIMIT_REASON_TEXT = {
  rejected: 'usage limit reached',
  overage_disabled: 'usage limit reached (paid overage is off for this session)',
  usage_limit: 'session usage limit reached',
};

const CONTINUE_HINT =
  'To keep going now on paid overage credits, change "Details > When a usage limit is reached" to "Continue".';

export function usageLimitStatusText({ label, reason, action, resetAtMs }) {
  const why = USAGE_LIMIT_REASON_TEXT[reason] ?? USAGE_LIMIT_REASON_TEXT.rejected;
  if (action === 'wait') {
    return `${label} ${why}. Waiting for reset. ${CONTINUE_HINT}`;
  }
  const reset = resetAtMs ? ` Limit resets ${new Date(resetAtMs).toISOString()}.` : '';
  return `${label} ${why}. Session stopped.${reset} ${CONTINUE_HINT}`;
}

/** A window at (or past) 100% rejects requests; just under it still has room. */
const WINDOW_FULL_PERCENT = 99.5;

/** True when any plan window is at 80%+, so a cached reading is worth re-checking. */
export function nearlyFull(result) {
  if (result?.status !== 'ok') return false;
  return (result.limits ?? []).some((l) => l.id !== 'overage' && (l.percent ?? 0) >= 80);
}

/**
 * The plan windows (session / weekly, never the paid-overage row) that are used up, from a
 * subscription-limits result. Returns `{ label, resetAtMs }` — the reset is when the *last*
 * full window reopens, since the agent can only run once all of them have — or null when
 * nothing is blocking (or the limits could not be read: this check fails open).
 */
export function blockingLimitWindow(result, nowMs = Date.now()) {
  if (result?.status !== 'ok') return null;
  const full = (result.limits ?? []).filter((l) => {
    if (l.id === 'overage' || l.percent == null || l.percent < WINDOW_FULL_PERCENT) return false;
    const resetMs = l.resets_at ? Date.parse(l.resets_at) : null;
    // A reset already in the past means the percentage is stale.
    return resetMs == null || Number.isNaN(resetMs) || resetMs > nowMs;
  });
  if (!full.length) return null;
  let resetAtMs = null;
  for (const l of full) {
    const ms = l.resets_at ? Date.parse(l.resets_at) : NaN;
    if (!Number.isNaN(ms) && (resetAtMs == null || ms > resetAtMs)) resetAtMs = ms;
  }
  return { label: full.map((l) => l.label).join(' + '), resetAtMs };
}
