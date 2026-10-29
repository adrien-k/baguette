import os from 'os';
import { ok } from '../lib/result.js';
import { getSystemInfo } from '../../system-information.js';

const CPU_SAMPLE_MS = 250;

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

const cpuTotals = () =>
  os.cpus().reduce(
    (sum, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      return { idle: sum.idle + cpu.times.idle, total: sum.total + total };
    },
    { idle: 0, total: 0 }
  );

/** Overall CPU busy time over a short sample, in percent. */
async function sampleCpuUsage() {
  const before = cpuTotals();
  await new Promise((resolve) => setTimeout(resolve, CPU_SAMPLE_MS));
  const after = cpuTotals();
  const total = after.total - before.total;
  return total > 0 ? percent(total - (after.idle - before.idle), total) : 0;
}

export function createSystemStatsTool() {
  return {
    name: 'SystemStats',
    description:
      'Health of the machine Baguette runs on: uptime, CPU (count, current usage, load average), ' +
      'RAM (total, used, free) and disk usage of the data directory. Use it when asked how the ' +
      'server is doing. (Bash with uptime, free and df works too.)',
    schema: {},
    handler: async () => {
      const info = getSystemInfo();
      const { memory, disk, loadAvg } = info;
      const diskUsed = disk.totalBytes - disk.freeBytes;
      return ok({
        hostname: info.hostname,
        platform: `${info.platform} ${info.arch}`,
        uptime: formatDuration(info.uptimeSeconds),
        uptime_seconds: Math.floor(info.uptimeSeconds),
        cpu: {
          count: info.cpu.count,
          model: info.cpu.model,
          usage_percent: await sampleCpuUsage(),
          load_average: { '1m': loadAvg[0], '5m': loadAvg[1], '15m': loadAvg[2] },
        },
        memory: {
          total: formatBytes(memory.totalBytes),
          used: formatBytes(memory.usedBytes),
          free: formatBytes(memory.freeBytes),
          used_percent: percent(memory.usedBytes, memory.totalBytes),
        },
        disk: {
          path: disk.path,
          total: formatBytes(disk.totalBytes),
          used: formatBytes(diskUsed),
          available: formatBytes(disk.availableBytes),
          used_percent: percent(diskUsed, disk.totalBytes),
        },
      });
    },
  };
}
