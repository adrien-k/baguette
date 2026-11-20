import { describe, it, expect, vi } from 'vitest';
import {
  clearSubscriptionLimitsCache,
  getCachedSubscriptionLimits,
  SUBSCRIPTION_LIMITS_TTL_MS,
  subscriptionLimit,
  subscriptionResult,
} from '../subscription-limits.js';

describe('subscriptionLimit', () => {
  it('clamps percent and keeps spend fields', () => {
    expect(subscriptionLimit({ id: 'a', label: 'A', percent: 140 }).percent).toBe(100);
    expect(subscriptionLimit({ id: 'a', label: 'A', percent: -3 }).percent).toBe(0);
    expect(subscriptionLimit({ id: 'a', label: 'A', usedUsd: 1, limitUsd: 2 })).toMatchObject({
      percent: null,
      used_usd: 1,
      limit_usd: 2,
    });
  });
});

describe('getCachedSubscriptionLimits', () => {
  it('serves the cache until the TTL, then refetches; refresh forces a fetch', async () => {
    clearSubscriptionLimitsCache();
    let t = 1_000;
    const now = () => t;
    const fetcher = vi.fn().mockResolvedValue(subscriptionResult('ok', { limits: [] }));

    const first = await getCachedSubscriptionLimits('k', fetcher, { now });
    expect(first.refreshed_at).toBe(new Date(1_000).toISOString());
    await getCachedSubscriptionLimits('k', fetcher, { now });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await getCachedSubscriptionLimits('k', fetcher, { now, refresh: true });
    expect(fetcher).toHaveBeenCalledTimes(2);

    t += SUBSCRIPTION_LIMITS_TTL_MS + 1;
    await getCachedSubscriptionLimits('k', fetcher, { now });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('turns a failing fetch into an error result instead of throwing', async () => {
    clearSubscriptionLimitsCache();
    const out = await getCachedSubscriptionLimits('bad', async () => {
      throw new Error('boom');
    });
    expect(out).toMatchObject({ status: 'error', message: 'boom', limits: [] });
  });

  it('shares one in-flight fetch between overlapping callers', async () => {
    clearSubscriptionLimitsCache();
    let release;
    const fetcher = vi.fn(
      () => new Promise((resolve) => (release = () => resolve(subscriptionResult('ok'))))
    );
    const first = getCachedSubscriptionLimits('slow', fetcher);
    const second = getCachedSubscriptionLimits('slow', fetcher, { refresh: true });
    release();
    expect(await first).toEqual(await second);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
