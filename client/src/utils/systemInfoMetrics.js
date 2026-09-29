export function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : n >= 100 ? 0 : 1;
  return `${n.toFixed(digits)} ${units[i]}`;
}

export function formatUptime(seconds) {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

export function memoryUsedPercent(memory) {
  if (!memory?.totalBytes) return null;
  return Math.min(100, Math.round((memory.usedBytes / memory.totalBytes) * 100));
}

export function diskUsedPercent(disk) {
  if (!disk?.totalBytes) return null;
  const used = disk.totalBytes - disk.availableBytes;
  return Math.min(100, Math.round((used / disk.totalBytes) * 100));
}

/** 1-minute load average as % of CPU capacity (can exceed 100%). */
export function cpuLoadPercent(info) {
  const cores = info?.cpu?.count;
  const load1 = info?.loadAvg?.[0];
  if (!cores || load1 == null) return null;
  return Math.round((load1 / cores) * 100);
}
