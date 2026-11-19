import logger from '../../logger.js';
import { loadOwnedAgentConfigDecrypted } from '../../services/agent-context.js';
import { percentOf, subscriptionLimit, subscriptionResult } from '../../lib/subscription-limits.js';

const CURSOR_API = 'https://api2.cursor.sh';
const DASHBOARD = `${CURSOR_API}/aiserver.v1.DashboardService`;
const FETCH_TIMEOUT_MS = 15_000;

/** Cents (number or int64 string) → USD; null when absent. */
function centsToUsd(value) {
  if (value == null || value === '') return null;
  const cents = Number(value);
  return Number.isFinite(cents) ? cents / 100 : null;
}

/** int64 epoch-ms string → ISO (null when absent/invalid). */
function msToIso(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

/**
 * Map Cursor's dashboard `GetCurrentPeriodUsage` (+ `GetPlanInfo`, `GetMe`) to card limits.
 * Amounts are cents; int64 fields arrive as strings and zero values are omitted.
 *
 *  - Included usage: the plan's included spend against its limit, until the cycle end.
 *  - Overage: this user's on-demand spend against their own cap, else the team pool's cap
 *    (`limit_usd` null = unlimited).
 */
export function normalizeCursorUsage({ usage, plan, me }) {
  const resetsAt = msToIso(usage?.billingCycleEnd ?? plan?.planInfo?.billingCycleEnd);
  const limits = [];

  const planUsage = usage?.planUsage;
  const includedLimit = centsToUsd(planUsage?.limit);
  if (includedLimit != null && includedLimit > 0) {
    const used = centsToUsd(planUsage.includedSpend ?? planUsage.totalSpend) ?? 0;
    limits.push(
      subscriptionLimit({
        id: 'included',
        label: 'Included usage',
        percent: percentOf(used, includedLimit),
        resetsAt,
        usedUsd: used,
        limitUsd: includedLimit,
      })
    );
  }

  const spend = usage?.spendLimitUsage;
  if (spend) {
    const used = centsToUsd(spend.individualUsed) ?? 0;
    const cap = centsToUsd(spend.individualLimit) ?? centsToUsd(spend.pooledLimit);
    limits.push(
      subscriptionLimit({
        id: 'overage',
        label: 'Overage',
        percent: cap != null ? percentOf(used, cap) : null,
        resetsAt,
        usedUsd: used,
        limitUsd: cap,
      })
    );
  }

  if (!limits.length) {
    return subscriptionResult('unavailable', { message: 'Cursor returned no usage limits.' });
  }
  return subscriptionResult('ok', {
    limits,
    account: { email: me?.email ?? null, plan: plan?.planInfo?.planName ?? null },
  });
}

async function connectCall(method, accessToken, signal) {
  const res = await fetch(`${DASHBOARD}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
    },
    body: '{}',
    signal,
  });
  if (!res.ok) throw new Error(`Cursor ${method} failed (${res.status})`);
  return res.json();
}

/** Plan name / email are extras: a failure is logged and the limits still show. */
async function optionalCall(method, accessToken, signal) {
  try {
    return await connectCall(method, accessToken, signal);
  } catch (err) {
    logger.warn({ method, err: err?.message }, 'cursor limits: optional lookup failed');
    return null;
  }
}

/** Trade the user's Cursor API key (`crsr_…`) for a short-lived dashboard access token. */
async function exchangeApiKey(apiKey, signal) {
  const res = await fetch(`${CURSOR_API}/auth/exchange_user_api_key`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal,
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Cursor key exchange failed (${res.status})`);
  const body = await res.json();
  return body.accessToken ?? null;
}

/**
 * Read the plan's included usage and on-demand spend with the Cursor API key already
 * configured for the agent (same key the SDK uses; no web session needed).
 */
export async function fetchCursorSubscriptionLimits({ app, userId, agentConfigId = null }) {
  const config =
    agentConfigId != null
      ? await loadOwnedAgentConfigDecrypted(agentConfigId, userId, app.get('db'))
      : null;
  if (!config?.api_key) {
    return subscriptionResult('unavailable', {
      message: 'Add a Cursor API key in Settings to show Cursor limits.',
    });
  }

  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const accessToken = await exchangeApiKey(config.api_key, signal);
  if (!accessToken) {
    return subscriptionResult('error', {
      message: 'Cursor rejected the API key. Check it in Settings.',
    });
  }
  const [usage, plan, me] = await Promise.all([
    connectCall('GetCurrentPeriodUsage', accessToken, signal),
    optionalCall('GetPlanInfo', accessToken, signal),
    optionalCall('GetMe', accessToken, signal),
  ]);
  return normalizeCursorUsage({ usage, plan, me });
}
