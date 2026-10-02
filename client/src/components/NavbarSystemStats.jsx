import { Link } from 'react-router-dom';
import { useLiveMetrics } from '../hooks/useLiveMetrics.js';
import { cpuLoadPercent, diskUsedPercent, memoryUsedPercent } from '../utils/systemInfoMetrics.js';
import { formatUsd } from '../utils/usageSeries.js';

const POLL_MS = 30_000;

export default function NavbarSystemStats({ leadingSeparator = false } = {}) {
  const { info } = useLiveMetrics({ intervalMs: POLL_MS });

  const usageUsd = info?.usage?.last_24h_cost_usd;
  const memPct = memoryUsedPercent(info?.memory);
  const diskPct = diskUsedPercent(info?.disk);
  const cpuPct = cpuLoadPercent(info);

  const systemParts = [];
  if (memPct != null) systemParts.push(`Mem ${memPct}%`);
  if (diskPct != null) systemParts.push(`Disk ${diskPct}%`);
  if (cpuPct != null) systemParts.push(`CPU ${cpuPct}%`);

  const hasSystem = systemParts.length > 0;
  if (usageUsd == null && !hasSystem) return null;

  const linkClass =
    'text-xs text-faint hover:text-secondary tabular-nums whitespace-nowrap shrink-0 transition-colors';

  const sep = leadingSeparator ? (
    <span className="text-xs text-faint/60" aria-hidden>
      ·
    </span>
  ) : null;

  if (usageUsd == null && hasSystem) {
    return (
      <div className="hidden lg:flex items-center gap-1.5 min-w-0 shrink-0">
        {sep}
        <Link to="/system" className={linkClass} title="System information">
          {systemParts.join(' · ')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0 shrink-0">
      {sep}
      {usageUsd != null ? (
        <Link to="/usage" className={linkClass} title="Usage in the last 24 hours">
          24h {formatUsd(usageUsd)}
        </Link>
      ) : null}
      {hasSystem ? (
        <div className="hidden lg:flex items-center gap-1.5 min-w-0">
          {usageUsd != null ? <span className="text-xs text-faint/60">·</span> : null}
          <Link to="/system" className={linkClass} title="System information">
            {systemParts.join(' · ')}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
