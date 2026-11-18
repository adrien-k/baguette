import { createHash } from 'node:crypto';
import os from 'node:os';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { percentOf, subscriptionLimit, subscriptionResult } from '../../lib/subscription-limits.js';
import logger from '../../logger.js';
import { anthropicApiRequest } from '../../lib/anthropic-api/client.js';
import { getClaudeEnv } from './env.js';

const FETCH_TIMEOUT_MS = 20_000;
const NOT_A_SUBSCRIPTION = 'Not signed in with a Claude subscription (API key or gateway).';

/** Utilization windows worth showing, in display order. */
const WINDOWS = [
  ['five_hour', 'session', 'Session (5h)'],
  ['seven_day', 'weekly', 'Weekly'],
  ['seven_day_opus', 'weekly_opus', 'Weekly (Opus)'],
  ['seven_day_sonnet', 'weekly_sonnet', 'Weekly (Sonnet)'],
];

function firstOfNextMonthIso(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/**
 * Map the SDK's structured `/usage` response (`SDKControlGetUsageResponse`) to card limits.
 * `extra_usage` amounts are minor currency units (cents).
 */
export function normalizeClaudeUsage(usage, now = new Date()) {
  if (!usage?.rate_limits_available || !usage.rate_limits) {
    return subscriptionResult('unavailable', { message: NOT_A_SUBSCRIPTION });
  }
  const limits = [];
  for (const [field, id, label] of WINDOWS) {
    const window = usage.rate_limits[field];
    if (!window || window.utilization == null) continue;
    limits.push(
      subscriptionLimit({
        id,
        label,
        percent: window.utilization,
        resetsAt: window.resets_at ?? null,
      })
    );
  }
  const extra = usage.rate_limits.extra_usage;
  if (extra?.is_enabled) {
    // Paid overage ("extra usage") this month: dollars used against the monthly spend limit
    // (limit_usd null = unlimited; the card shows "$0 / Unlimited" or "$0 / $800").
    const usedUsd = (extra.used_credits ?? 0) / 100;
    const limitUsd = extra.monthly_limit != null ? extra.monthly_limit / 100 : null;
    let percent = null;
    if (limitUsd != null) percent = extra.utilization ?? percentOf(usedUsd, limitUsd);
    limits.push(
      subscriptionLimit({
        id: 'overage',
        label: 'Overage',
        percent,
        resetsAt: firstOfNextMonthIso(now),
        usedUsd,
        limitUsd,
      })
    );
  } else if (extra) {
    limits.push(subscriptionLimit({ id: 'overage', label: 'Overage', note: 'Not enabled' }));
  }
  return subscriptionResult('ok', {
    limits,
    account: { plan: usage.subscription_type ?? null },
  });
}

/** A prompt stream that never yields: opens the CLI session without starting a turn. */
function idlePrompt(signal) {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ value: undefined, done: true }), {
            once: true,
          });
        }),
    }),
  };
}

const RATE_LIMIT_PROBE_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_API_BASE = 'https://api.anthropic.com';

/** Epoch seconds header → ISO string (null when absent/invalid). */
function resetHeaderIso(headers, name) {
  const seconds = Number(headers.get(name));
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

/** Fraction header ("0.02") → percent; null when absent/invalid. */
function utilizationHeaderPercent(headers, name) {
  const raw = headers.get(name);
  if (raw == null || raw === '') return null;
  const fraction = Number(raw);
  return Number.isFinite(fraction) ? fraction * 100 : null;
}

/**
 * Map the `anthropic-ratelimit-unified-*` response headers to card limits. Every Claude
 * subscription response carries them, including inference-only setup tokens that the SDK's
 * `/usage` call (profile scope) cannot serve.
 */
export function normalizeClaudeRateLimitHeaders(headers) {
  const limits = [];
  for (const [prefix, id, label] of [
    ['5h', 'session', 'Session (5h)'],
    ['7d', 'weekly', 'Weekly'],
  ]) {
    const percent = utilizationHeaderPercent(
      headers,
      `anthropic-ratelimit-unified-${prefix}-utilization`
    );
    if (percent == null) continue;
    limits.push(
      subscriptionLimit({
        id,
        label,
        percent,
        resetsAt: resetHeaderIso(headers, `anthropic-ratelimit-unified-${prefix}-reset`),
      })
    );
  }
  if (!limits.length) {
    return subscriptionResult('unavailable', { message: NOT_A_SUBSCRIPTION });
  }
  limits.push(overageLimitFromHeaders(headers));
  return subscriptionResult('ok', {
    limits,
    // Setup tokens can run requests but not read the profile (no `user:profile` scope).
    account: { note: 'Email and plan need a full Claude login, not a setup token' },
  });
}

const OVERAGE_DISABLED_REASONS = {
  org_level_disabled: 'disabled',
  org_level_disabled_until: 'disabled',
  overage_not_provisioned: 'not enabled on this plan',
  out_of_credits: 'out of credits',
  member_level_disabled: 'disabled',
};

/**
 * Overage row for the header path. The headers say whether overage is available but not how
 * many dollars were spent (that needs the SDK's profile-scoped `/usage`), so the row carries
 * a note instead of an amount.
 */
function overageLimitFromHeaders(headers) {
  const status = headers.get('anthropic-ratelimit-unified-overage-status');
  const reason = headers.get('anthropic-ratelimit-unified-overage-disabled-reason');
  let note = 'Spend not available for this login';
  if (status === 'rejected') {
    const why = OVERAGE_DISABLED_REASONS[reason] ?? reason?.replace(/_/g, ' ');
    note = why ? `Not available — ${why}` : 'Not available';
  }
  return subscriptionLimit({ id: 'overage', label: 'Overage', note });
}

/**
 * Read plan limits with a 1-token request authenticated by the subscription (setup) token.
 * Costs a negligible amount of the plan's own usage.
 */
async function fetchClaudeLimitsFromHeaders(authToken) {
  const { response } = await anthropicApiRequest(
    { baseUrl: ANTHROPIC_API_BASE, authToken },
    'POST',
    '/v1/messages',
    {
      body: {
        model: RATE_LIMIT_PROBE_MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      },
      extraHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  );
  // A 429 (limit reached) still carries the headers, so parse before checking the status.
  const result = normalizeClaudeRateLimitHeaders(response.headers);
  if (result.status === 'ok') return result;
  if (response.status === 401 || response.status === 403) {
    return subscriptionResult('error', {
      message: 'Claude rejected the auth token. Generate a new one with `claude setup-token`.',
    });
  }
  // Anything else without rate-limit headers (API change, retired probe model, outage) is a
  // failed read, not "no subscription".
  if (!response.ok && response.status !== 429) {
    return subscriptionResult('error', {
      message: `Claude limits request failed (HTTP ${response.status}).`,
    });
  }
  return result;
}

/**
 * Logins the SDK's `/usage` already said have no plan data (API key, or a setup token without
 * profile scope), by credential hash, so polling does not spawn a CLI process every time.
 */
const sdkUnavailableFor = new Set();

function credentialKey(env) {
  const credential = env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY;
  return credential ? createHash('sha256').update(credential).digest('hex') : null;
}

/**
 * Read plan limits for the user's Claude credentials:
 *  1. the SDK's structured `/usage` (full detail incl. overage dollars) when the login allows it;
 *  2. otherwise, for a setup token, the rate-limit headers of a 1-token request.
 * The SDK call is experimental, so its failures fall through rather than failing the card.
 */
export async function fetchClaudeSubscriptionLimits({ app, userId, agentConfigId = null }) {
  const env = await getClaudeEnv(app, userId, agentConfigId);
  const credential = credentialKey(env);
  let sdkResult = null;
  let sdkError = null;
  if (!credential || !sdkUnavailableFor.has(credential)) {
    try {
      sdkResult = await fetchClaudeLimitsFromSdk(env);
      if (sdkResult.status === 'unavailable' && credential) sdkUnavailableFor.add(credential);
    } catch (err) {
      sdkError = err;
      logger.warn({ err: err?.message }, 'claude limits: SDK usage lookup failed, trying fallback');
    }
    if (sdkResult?.status === 'ok') return sdkResult;
  }

  const authToken = env.ANTHROPIC_AUTH_TOKEN;
  if (authToken && !env.ANTHROPIC_BASE_URL) return fetchClaudeLimitsFromHeaders(authToken);
  if (sdkError) throw sdkError;
  return sdkResult ?? subscriptionResult('unavailable', { message: NOT_A_SUBSCRIPTION });
}

async function fetchClaudeLimitsFromSdk(env) {
  const abortController = new AbortController();
  const q = query({
    prompt: idlePrompt(abortController.signal),
    options: { env, cwd: os.tmpdir(), abortController, settingSources: [] },
  });
  let timer;
  try {
    const usage = await Promise.race([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out reading Claude usage')),
          FETCH_TIMEOUT_MS
        );
      }),
    ]);
    const result = normalizeClaudeUsage(usage);
    if (result.status === 'ok') {
      // The login's email is only known to full (profile-scoped) logins; best effort.
      const info = await q.accountInfo().catch((err) => {
        logger.warn({ err: err?.message }, 'claude limits: account info unavailable');
        return null;
      });
      if (info?.email) result.account = { ...result.account, email: info.email };
    }
    return result;
  } finally {
    clearTimeout(timer);
    abortController.abort();
    try {
      q.close();
    } catch (err) {
      logger.debug({ err: err?.message }, 'claude limits: query already closed');
    }
  }
}
