import { describe, expect, it } from 'vitest';
import {
  cpuLoadPercent,
  diskUsedPercent,
  formatBytes,
  memoryUsedPercent,
} from '../systemInfoMetrics.js';

describe('systemInfoMetrics', () => {
  it('formatBytes formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('memoryUsedPercent', () => {
    expect(memoryUsedPercent({ totalBytes: 100, usedBytes: 25 })).toBe(25);
    expect(memoryUsedPercent(null)).toBe(null);
  });

  it('diskUsedPercent', () => {
    expect(diskUsedPercent({ totalBytes: 200, availableBytes: 50 })).toBe(75);
  });

  it('cpuLoadPercent', () => {
    expect(cpuLoadPercent({ cpu: { count: 4 }, loadAvg: [2, 1, 0.5] })).toBe(50);
  });
});
