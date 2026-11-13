import { describe, it, expect } from 'vitest';
import { createIpRateLimiter } from '../ip-rate-limit.js';

describe('createIpRateLimiter', () => {
  it('limits after maxAttempts in the window', () => {
    const limiter = createIpRateLimiter({ windowMs: 1000, maxAttempts: 2 });
    const t0 = 1_000_000;
    limiter.record('1.1.1.1', t0);
    expect(limiter.isLimited('1.1.1.1', t0)).toBe(false);
    limiter.record('1.1.1.1', t0);
    expect(limiter.isLimited('1.1.1.1', t0)).toBe(true);
  });

  it('evicts expired buckets so distinct IPs do not accumulate', () => {
    const limiter = createIpRateLimiter({ windowMs: 1000, maxAttempts: 5 });
    const t0 = 1_000_000;
    limiter.record('1.1.1.1', t0);
    limiter.record('2.2.2.2', t0 + 10);
    expect(limiter.size).toBe(2);
    limiter.record('3.3.3.3', t0 + 2000);
    expect(limiter.size).toBe(1);
    expect(limiter.isLimited('1.1.1.1', t0 + 2000)).toBe(false);
  });

  it('caps map size even within the window', () => {
    const limiter = createIpRateLimiter({ windowMs: 60_000, maxAttempts: 5, maxKeys: 3 });
    const t0 = 1_000_000;
    limiter.record('a', t0);
    limiter.record('b', t0);
    limiter.record('c', t0);
    limiter.record('d', t0);
    expect(limiter.size).toBeLessThanOrEqual(3);
  });
});
