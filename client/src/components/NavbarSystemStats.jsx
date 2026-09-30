import { Link } from 'react-router-dom';
import { useLiveMetrics } from '../hooks/useLiveMetrics.js';
import { cpuLoadPercent, diskUsedPercent, memoryUsedPercent } from '../utils/systemInfoMetrics.js';
import { formatUsd } from '../utils/usageSeries.js';

const POLL_MS = 30_000;

export default function NavbarSystemStats() {
  const { info } = useLiveMetrics({ intervalMs: POLL_MS });

  const usageUsd = info?.usage?.last_24h_cost_usd;
  const memPct = memoryUsedPercent(info?.memory);
  const diskPct = diskUsedPercent(info?.disk);
  const cpuPct = cpuLoadPercent(info);

  if (usageUsd == null && memPct == null && diskPct == null && cpuPct == null) return null;

  const systemParts = [];
  if (memPct != null) systemParts.push(`Mem ${memPct}%`);
  if (diskPct != null) systemParts.push(`Disk ${diskPct}%`);
  if (cpuPct != null) systemParts.push(`CPU ${cpuPct}%`);

  const linkClass =
    'text-xs text-faint hover:text-secondary tabular-nums whitespace-nowrap shrink-0 transition-colors';

  return (
    <div className="hidden sm:flex items-center gap-1.5 min-w-0">
      {usageUsd != null ? (
        <>
          <Link to="/usage" className={linkClass} title="Usage in the last 24 hours">
            24h {formatUsd(usageUsd)}
          </Link>
          {systemParts.length > 0 ? <span className="text-xs text-faint/60">·</span> : null}
        </>
      ) : null}
      {systemParts.length > 0 ? (
        <Link to="/system" className={linkClass} title="System information">
          {systemParts.join(' · ')}
        </Link>
      ) : null}
    </div>
  );
}
