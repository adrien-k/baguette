import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  default: () => ({
    where: () => ({
      where: () => ({
        sum: () => ({
          first: async () => ({ cost_usd: 1.25 }),
        }),
      }),
    }),
  }),
}));

import { getNavbarSystemInformation, getSystemInfo } from '../system-information.js';

describe('getSystemInfo', () => {
  it('returns host, deployment, and disk stats', () => {
    const info = getSystemInfo();

    expect(info.hostname).toBeTypeOf('string');
    expect(info.cpu.count).toBeGreaterThan(0);
    expect(info.cpu.model).toBeTypeOf('string');
    expect(info.memory.totalBytes).toBeGreaterThan(0);
    expect(info.memory.usedBytes).toBeGreaterThanOrEqual(0);
    expect(info.memory.freeBytes).toBeGreaterThanOrEqual(0);
    expect(info.disk.path).toBeTypeOf('string');
    expect(info.disk.totalBytes).toBeGreaterThan(0);
    expect(info.disk.availableBytes).toBeLessThanOrEqual(info.disk.totalBytes);
    expect(info.gitSha === null || typeof info.gitSha === 'string').toBe(true);
    expect(info.containerUptimeSeconds === null || info.containerUptimeSeconds >= 0).toBe(true);
  });
});

describe('getNavbarSystemInformation', () => {
  it('returns a slim resource snapshot without deployment fields', async () => {
    const info = await getNavbarSystemInformation(1);

    expect(info.cpu.count).toBeGreaterThan(0);
    expect(info.cpu.model).toBeUndefined();
    expect(info.loadAvg).toBeInstanceOf(Array);
    expect(info.memory.totalBytes).toBeGreaterThan(0);
    expect(info.memory.usedBytes).toBeGreaterThanOrEqual(0);
    expect(info.memory.freeBytes).toBeUndefined();
    expect(info.disk.totalBytes).toBeGreaterThan(0);
    expect(info.disk.path).toBeUndefined();
    expect(info.usage.last_24h_cost_usd).toBe(1.25);
    expect(info.gitSha).toBeUndefined();
    expect(info.hostname).toBeUndefined();
  });
});
