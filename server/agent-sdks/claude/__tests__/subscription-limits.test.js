import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
vi.mock('../env.js', () => ({ getClaudeEnv: vi.fn() }));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getClaudeEnv } from '../env.js';
import {
  fetchClaudeSubscriptionLimits,
  normalizeClaudeRateLimitHeaders,
  normalizeClaudeUsage,
} from '../subscription-limits.js';

const NOW = new Date('2026-11-18T12:00:00Z');

describe('normalizeClaudeUsage', () => {
  it('maps session, weekly and spend limit (cents → USD, resets next month)', () => {
    const out = normalizeClaudeUsage(
      {
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 10, resets_at: '2026-11-18T16:03:00Z' },
          seven_day: { utilization: 41, resets_at: '2026-11-24T02:00:00Z' },
          seven_day_opus: null,
          extra_usage: {
            is_enabled: true,
            monthly_limit: 80000,
            used_credits: 1398,
            utilization: 1.7,
          },
        },
      },
      NOW
    );
    expect(out.status).toBe('ok');
    expect(out.limits.map((l) => [l.id, l.label, l.percent])).toEqual([
      ['session', 'Session (5h)', 10],
      ['weekly', 'Weekly', 41],
      ['overage', 'Overage Usage limit', 1.7],
    ]);
    // Overage: dollars of paid extra usage this month against the monthly spend limit.
    expect(out.limits[2]).toMatchObject({
      used_usd: 13.98,
      limit_usd: 800,
      resets_at: '2026-12-01T00:00:00.000Z',
    });
  });

  it('shows overage as unlimited when extra usage has no monthly cap', () => {
    const out = normalizeClaudeUsage(
      {
        rate_limits_available: true,
        rate_limits: {
          extra_usage: { is_enabled: true, monthly_limit: null, used_credits: 0 },
        },
      },
      NOW
    );
    expect(out.limits).toEqual([
      {
        id: 'overage',
        label: 'Overage Usage limit',
        percent: null,
        resets_at: '2026-12-01T00:00:00.000Z',
        used_usd: 0,
        limit_usd: null,
        note: null,
      },
    ]);
  });

  it('marks disabled extra usage as not enabled and skips windows without data', () => {
    const out = normalizeClaudeUsage(
      {
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: null, resets_at: null },
          extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null },
        },
      },
      NOW
    );
    expect(out.limits.map((l) => [l.id, l.note])).toEqual([['overage', 'Not enabled']]);
  });

  it('is unavailable for API-key / gateway sessions', () => {
    const out = normalizeClaudeUsage({ rate_limits_available: false, rate_limits: null });
    expect(out.status).toBe('unavailable');
  });
});

const headersOf = (obj) => new Headers(obj);

describe('normalizeClaudeRateLimitHeaders', () => {
  it('maps the unified 5h / 7d utilization fractions and reset epochs', () => {
    const out = normalizeClaudeRateLimitHeaders(
      headersOf({
        'anthropic-ratelimit-unified-5h-utilization': '0.02',
        'anthropic-ratelimit-unified-5h-reset': '1795036200',
        'anthropic-ratelimit-unified-7d-utilization': '0.41',
        'anthropic-ratelimit-unified-7d-reset': '1795539600',
      })
    );
    expect(out.status).toBe('ok');
    expect(out.limits.slice(0, 2)).toEqual([
      {
        id: 'session',
        label: 'Session (5h)',
        percent: 2,
        resets_at: new Date(1795036200_000).toISOString(),
        used_usd: null,
        limit_usd: null,
        note: null,
      },
      {
        id: 'weekly',
        label: 'Weekly',
        percent: 41,
        resets_at: new Date(1795539600_000).toISOString(),
        used_usd: null,
        limit_usd: null,
        note: null,
      },
    ]);
  });

  it('has no account details for a setup token', () => {
    const out = normalizeClaudeRateLimitHeaders(
      headersOf({ 'anthropic-ratelimit-unified-5h-utilization': '0.02' })
    );
    expect(out.account).toBeNull();
  });

  it('adds an Overage row explaining why spend is unavailable for this login', () => {
    const base = {
      'anthropic-ratelimit-unified-5h-utilization': '0.02',
      'anthropic-ratelimit-unified-5h-reset': '1795036200',
    };
    const rejected = normalizeClaudeRateLimitHeaders(
      headersOf({
        ...base,
        'anthropic-ratelimit-unified-overage-status': 'rejected',
        'anthropic-ratelimit-unified-overage-disabled-reason': 'org_level_disabled_until',
      })
    );
    expect(rejected.limits.at(-1)).toMatchObject({
      id: 'overage',
      label: 'Overage Usage limit',
      note: 'Not available — disabled',
    });
    const allowed = normalizeClaudeRateLimitHeaders(
      headersOf({ ...base, 'anthropic-ratelimit-unified-overage-status': 'allowed' })
    );
    expect(allowed.limits.at(-1).note).toBe('Enabled — spend needs a full Claude login');
    const inUse = normalizeClaudeRateLimitHeaders(
      headersOf({
        ...base,
        'anthropic-ratelimit-unified-overage-status': 'allowed',
        'anthropic-ratelimit-unified-overage-utilization': '0.04',
        'anthropic-ratelimit-unified-overage-reset': '1796083200',
      })
    );
    expect(inUse.limits.at(-1)).toMatchObject({
      id: 'overage',
      percent: 4,
      resets_at: '2026-12-01T00:00:00.000Z',
      note: 'Requires a full Claude login to show the limit in $',
    });
  });

  it('is unavailable without any unified headers (API key / gateway)', () => {
    expect(normalizeClaudeRateLimitHeaders(headersOf({})).status).toBe('unavailable');
  });
});

describe('fetchClaudeSubscriptionLimits', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const sdkQuery = (usage) => ({
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: vi.fn().mockResolvedValue(usage),
    accountInfo: vi.fn().mockResolvedValue({ email: 'me@example.com' }),
    close: vi.fn(),
  });

  it('falls back to rate-limit headers for a setup token the SDK cannot read', async () => {
    getClaudeEnv.mockResolvedValue({ ANTHROPIC_AUTH_TOKEN: 'sk-ant-oat01-x' });
    query.mockReturnValue(sdkQuery({ rate_limits_available: false, rate_limits: null }));
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'anthropic-ratelimit-unified-5h-utilization': '0.1' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchClaudeSubscriptionLimits({ app: {}, userId: 1, agentConfigId: 1 });
    expect(out.status).toBe('ok');
    expect(out.limits[0]).toMatchObject({ id: 'session', percent: 10 });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer sk-ant-oat01-x');
    expect(init.headers['anthropic-beta']).toBe('oauth-2025-04-20');
  });

  it('prefers the SDK result when it works (includes the spend limit)', async () => {
    getClaudeEnv.mockResolvedValue({ ANTHROPIC_AUTH_TOKEN: 'sk-ant-oat01-full-login' });
    query.mockReturnValue(
      sdkQuery({
        rate_limits_available: true,
        rate_limits: { five_hour: { utilization: 5, resets_at: null } },
      })
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchClaudeSubscriptionLimits({ app: {}, userId: 1 });
    expect(out.limits[0]).toMatchObject({ id: 'session', percent: 5 });
    expect(out.account).toMatchObject({ email: 'me@example.com' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not probe the API for an API-key login', async () => {
    getClaudeEnv.mockResolvedValue({ ANTHROPIC_API_KEY: 'sk-ant-api-1' });
    query.mockReturnValue(sdkQuery({ rate_limits_available: false, rate_limits: null }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchClaudeSubscriptionLimits({ app: {}, userId: 1 });
    expect(out.status).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a rejected token as an error', async () => {
    getClaudeEnv.mockResolvedValue({ ANTHROPIC_AUTH_TOKEN: 'bad-token' });
    query.mockReturnValue(sdkQuery({ rate_limits_available: false, rate_limits: null }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const out = await fetchClaudeSubscriptionLimits({ app: {}, userId: 1 });
    expect(out.status).toBe('error');
  });

  it('skips the SDK for a login it already reported as having no plan data', async () => {
    getClaudeEnv.mockResolvedValue({ ANTHROPIC_AUTH_TOKEN: 'sk-ant-oat01-memo' });
    query.mockReturnValue(sdkQuery({ rate_limits_available: false, rate_limits: null }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response('{}', {
            status: 200,
            headers: { 'anthropic-ratelimit-unified-5h-utilization': '0.1' },
          })
      )
    );
    await fetchClaudeSubscriptionLimits({ app: {}, userId: 1 });
    await fetchClaudeSubscriptionLimits({ app: {}, userId: 1 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('turns a failing limits request (API change / outage) into an error, not "no subscription"', async () => {
    getClaudeEnv.mockResolvedValue({ ANTHROPIC_AUTH_TOKEN: 'sk-ant-oat01-down' });
    query.mockReturnValue(sdkQuery({ rate_limits_available: false, rate_limits: null }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    const out = await fetchClaudeSubscriptionLimits({ app: {}, userId: 1 });
    expect(out).toMatchObject({ status: 'error', message: expect.stringContaining('404') });
  });

  it('survives the SDK usage call disappearing', async () => {
    getClaudeEnv.mockResolvedValue({ ANTHROPIC_AUTH_TOKEN: 'sk-ant-oat01-renamed' });
    query.mockReturnValue({ close: vi.fn() }); // method renamed/removed in a newer SDK
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response('{}', {
            status: 200,
            headers: { 'anthropic-ratelimit-unified-5h-utilization': '0.3' },
          })
      )
    );
    const out = await fetchClaudeSubscriptionLimits({ app: {}, userId: 1 });
    expect(out.limits[0]).toMatchObject({ id: 'session', percent: 30 });
  });
});
