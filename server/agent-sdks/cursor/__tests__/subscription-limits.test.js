import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../services/agent-context.js', () => ({
  loadOwnedAgentConfigDecrypted: vi.fn(),
}));

import { loadOwnedAgentConfigDecrypted } from '../../../services/agent-context.js';
import { fetchCursorSubscriptionLimits, normalizeCursorUsage } from '../subscription-limits.js';

// Shapes captured from Cursor's DashboardService (cents; int64 values are strings).
const USAGE = {
  billingCycleStart: '1793983496000',
  billingCycleEnd: '1796575496000',
  planUsage: { totalSpend: 160, includedSpend: 160, remaining: 1840, limit: 2000 },
  spendLimitUsage: {
    totalSpend: 14776,
    pooledLimit: '500000',
    pooledUsed: 14776,
    pooledRemaining: '485224',
    limitType: 'team',
  },
};
const PLAN = { planInfo: { planName: 'Team', billingCycleEnd: '1796575496000' } };
const ME = { email: 'me@example.com', teamName: 'Acme' };

describe('normalizeCursorUsage', () => {
  it('maps included usage ($1.60 of $20 = 8%) and team-pool overage ($0 of $5000)', () => {
    const out = normalizeCursorUsage({ usage: USAGE, plan: PLAN, me: ME });
    expect(out.status).toBe('ok');
    expect(out.limits).toEqual([
      {
        id: 'included',
        label: 'Included usage',
        percent: 8,
        resets_at: new Date(1796575496000).toISOString(),
        used_usd: 1.6,
        limit_usd: 20,
        note: null,
      },
      {
        id: 'overage',
        label: 'Overage',
        percent: 0,
        resets_at: new Date(1796575496000).toISOString(),
        used_usd: 0,
        limit_usd: 5000,
        note: null,
      },
    ]);
    expect(out.account).toEqual({ email: 'me@example.com', plan: 'Team' });
  });

  it('prefers the individual cap and counts the user’s own on-demand spend', () => {
    const out = normalizeCursorUsage({
      usage: {
        ...USAGE,
        spendLimitUsage: { individualLimit: 5000, individualUsed: 1250, pooledLimit: '500000' },
      },
    });
    expect(out.limits[1]).toMatchObject({
      id: 'overage',
      used_usd: 12.5,
      limit_usd: 50,
      percent: 25,
    });
  });

  it('shows overage as unlimited when no cap is reported', () => {
    const out = normalizeCursorUsage({
      usage: { ...USAGE, spendLimitUsage: { individualUsed: 0 } },
    });
    expect(out.limits[1]).toMatchObject({ used_usd: 0, limit_usd: null, percent: null });
  });

  it('is unavailable when Cursor returns no limits', () => {
    expect(normalizeCursorUsage({ usage: {} }).status).toBe('unavailable');
  });
});

describe('fetchCursorSubscriptionLimits', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const app = { get: () => ({}) };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('asks for an API key when the config has none', async () => {
    loadOwnedAgentConfigDecrypted.mockResolvedValue({ api_key: null });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchCursorSubscriptionLimits({ app, userId: 1, agentConfigId: 2 });
    expect(out.status).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges the API key, then reads usage, plan and account', async () => {
    loadOwnedAgentConfigDecrypted.mockResolvedValue({ api_key: 'crsr_key' });
    const fetchMock = vi.fn(async (url) => {
      if (url.endsWith('/auth/exchange_user_api_key')) return json({ accessToken: 'jwt-1' });
      if (url.endsWith('/GetCurrentPeriodUsage')) return json(USAGE);
      if (url.endsWith('/GetPlanInfo')) return json(PLAN);
      if (url.endsWith('/GetMe')) return json(ME);
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchCursorSubscriptionLimits({ app, userId: 1, agentConfigId: 2 });
    expect(out.limits.map((l) => l.id)).toEqual(['included', 'overage']);
    expect(out.account).toEqual({ email: 'me@example.com', plan: 'Team' });
    const [exchangeUrl, exchangeInit] = fetchMock.mock.calls[0];
    expect(exchangeUrl).toBe('https://api2.cursor.sh/auth/exchange_user_api_key');
    expect(exchangeInit.headers.Authorization).toBe('Bearer crsr_key');
    const usageCall = fetchMock.mock.calls.find(([u]) => u.endsWith('/GetCurrentPeriodUsage'));
    expect(usageCall[1].headers.Authorization).toBe('Bearer jwt-1');
    expect(usageCall[1].headers['Connect-Protocol-Version']).toBe('1');
  });

  it('still shows limits when the plan / account lookups fail', async () => {
    loadOwnedAgentConfigDecrypted.mockResolvedValue({ api_key: 'crsr_key' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (url.endsWith('/auth/exchange_user_api_key')) return json({ accessToken: 'jwt' });
        if (url.endsWith('/GetCurrentPeriodUsage')) return json(USAGE);
        return json({}, 500);
      })
    );
    const out = await fetchCursorSubscriptionLimits({ app, userId: 1, agentConfigId: 2 });
    expect(out.status).toBe('ok');
    expect(out.account).toEqual({ email: null, plan: null });
  });

  it('reports a rejected API key as an error', async () => {
    loadOwnedAgentConfigDecrypted.mockResolvedValue({ api_key: 'bad' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 401)));
    const out = await fetchCursorSubscriptionLimits({ app, userId: 1, agentConfigId: 2 });
    expect(out.status).toBe('error');
  });
});
