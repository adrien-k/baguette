import { describe, it, expect } from 'vitest';

import { getHostMetrics } from '../live-metrics.js';

describe('getHostMetrics', () => {
  it('returns cpu, memory, and disk stats', () => {
    const info = getHostMetrics();

    expect(info.hostname).toBeTypeOf('string');
    expect(info.cpu.count).toBeGreaterThan(0);
    expect(info.memory.totalBytes).toBeGreaterThan(0);
    expect(info.memory.usedBytes).toBeGreaterThanOrEqual(0);
    expect(info.memory.freeBytes).toBeGreaterThanOrEqual(0);
    expect(info.disk.path).toBeTypeOf('string');
    expect(info.disk.totalBytes).toBeGreaterThan(0);
    expect(info.disk.availableBytes).toBeLessThanOrEqual(info.disk.totalBytes);
  });
});
