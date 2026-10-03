import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { useLiveMetrics } from '../hooks/useLiveMetrics.js';
import { cpuLoadPercent, diskUsedPercent, memoryUsedPercent } from '../utils/systemInfoMetrics.js';
import { formatUsd } from '../utils/usageSeries.js';

const POLL_MS = 30_000;

function DotSep() {
  return (
    <span className="text-xs text-faint/60" aria-hidden>
      ·
    </span>
  );
}

const ACTIVE_AGENTS_USAGE_HASH = '/usage#active-agents';

export default function NavbarSystemStats({ leadingSeparator = false } = {}) {
  const { info } = useLiveMetrics({ intervalMs: POLL_MS });

  const usageUsd = info?.usage?.last_24h_cost_usd;
  const runningChatAgents = info?.sessions?.running_agents ?? 0;
  const runningReviewAgents = info?.sessions?.running_reviewers ?? 0;
  const activeAgentCount = runningChatAgents + runningReviewAgents;
  const memPct = memoryUsedPercent(info?.memory);
  const diskPct = diskUsedPercent(info?.disk);
  const cpuPct = cpuLoadPercent(info);

  const systemParts = [];
  if (memPct != null) systemParts.push(`Mem ${memPct}%`);
  if (diskPct != null) systemParts.push(`Disk ${diskPct}%`);
  if (cpuPct != null) systemParts.push(`CPU ${cpuPct}%`);

  const hasSystem = systemParts.length > 0;
  const hasSessions = activeAgentCount > 0;
  if (usageUsd == null && !hasSystem && !hasSessions) return null;

  const linkClass =
    'text-xs text-faint hover:text-secondary tabular-nums whitespace-nowrap shrink-0 transition-colors';

  const segments = [];

  if (activeAgentCount > 0) {
    segments.push(
      <Link
        key="agents"
        to={ACTIVE_AGENTS_USAGE_HASH}
        className={`${linkClass} hidden sm:inline-flex items-center gap-1`}
        title="View active chat and review agents on Usage"
      >
        <Bot className="w-3.5 h-3.5 text-accent motion-safe:animate-pulse shrink-0" aria-hidden />
        {activeAgentCount} {activeAgentCount === 1 ? 'agent' : 'agents'}
      </Link>
    );
  }
  if (usageUsd != null) {
    segments.push(
      <Link key="usage" to="/usage" className={linkClass} title="Usage in the last 24 hours">
        24h {formatUsd(usageUsd)}
      </Link>
    );
  }

  const systemLink = hasSystem ? (
    <Link key="system" to="/system" className={linkClass} title="System information">
      {systemParts.join(' · ')}
    </Link>
  ) : null;

  const showLeadingSep = leadingSeparator && (segments.length > 0 || systemLink);

  return (
    <div className="hidden sm:flex items-center gap-1.5 min-w-0 shrink-0">
      {showLeadingSep ? <DotSep /> : null}
      {segments.map((node, index) => (
        <Fragment key={node.key}>
          {index > 0 ? <DotSep /> : null}
          {node}
        </Fragment>
      ))}
      {systemLink ? (
        <div className="hidden lg:flex items-center gap-1.5 min-w-0">
          {segments.length > 0 ? <DotSep /> : null}
          {systemLink}
        </div>
      ) : null}
    </div>
  );
}
