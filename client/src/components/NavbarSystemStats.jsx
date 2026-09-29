import { Link } from 'react-router-dom';
import { useSystemInfo } from '../hooks/useSystemInfo.js';
import { cpuLoadPercent, diskUsedPercent, memoryUsedPercent } from '../utils/systemInfoMetrics.js';

const POLL_MS = 30_000;

export default function NavbarSystemStats() {
  const { info } = useSystemInfo({ intervalMs: POLL_MS });

  const memPct = memoryUsedPercent(info?.memory);
  const diskPct = diskUsedPercent(info?.disk);
  const cpuPct = cpuLoadPercent(info);

  if (memPct == null && diskPct == null && cpuPct == null) return null;

  const parts = [];
  if (memPct != null) parts.push(`Mem ${memPct}%`);
  if (diskPct != null) parts.push(`Disk ${diskPct}%`);
  if (cpuPct != null) parts.push(`CPU ${cpuPct}%`);

  return (
    <Link
      to="/system"
      className="hidden sm:block text-xs text-faint hover:text-secondary tabular-nums whitespace-nowrap shrink-0 transition-colors"
      title="System information"
    >
      {parts.join(' · ')}
    </Link>
  );
}
