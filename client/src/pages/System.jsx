import { useState, useCallback } from 'react';
import { toastError } from '../utils/toastError.jsx';
import { SettingsSection } from '../components/SettingsSection.jsx';
import { useSystemInfo } from '../hooks/useSystemInfo.js';
import { formatBytes, formatUptime } from '../utils/systemInfoMetrics.js';

function UsageMeter({ used, total }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="h-2 rounded-full bg-control overflow-hidden">
      <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function SystemStat({ label, value, sub }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 sm:gap-4 py-2 border-b border-line last:border-0">
      <span className="text-sm text-fg-muted">{label}</span>
      <div className="text-sm text-heading text-left sm:text-right">
        <div>{value}</div>
        {sub ? <div className="text-xs text-faint mt-0.5">{sub}</div> : null}
      </div>
    </div>
  );
}

export default function System() {
  const [refreshing, setRefreshing] = useState(false);
  const onLoadError = useCallback(
    (err) => toastError('Failed to load system information', err),
    []
  );
  const { info, loading, reload } = useSystemInfo({ onError: onLoadError });

  const handleRefresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const mem = info?.memory;
  const disk = info?.disk;
  const loadAvg = info?.loadAvg;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-fg">System</h1>
        <p className="text-sm text-fg-muted mt-1 max-w-2xl">
          Host resources and deployment info for this Baguette instance. Disk usage is for the data
          directory.
        </p>
      </div>

      <div className="space-y-6">
        <SettingsSection
          title="Deployment"
          description="Version baked into the container image at build time."
        >
          <div className="flex justify-end -mt-2 mb-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="text-xs text-accent hover:text-accent disabled:text-faint"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {loading && !info ? (
            <p className="text-sm text-faint">Loading…</p>
          ) : info ? (
            <div>
              <SystemStat
                label="Git revision"
                value={info.gitSha ? info.gitSha.slice(0, 12) : '—'}
                sub={info.gitSha && info.gitSha.length > 12 ? info.gitSha : null}
              />
              <SystemStat
                label="Container uptime"
                value={
                  info.containerUptimeSeconds != null
                    ? formatUptime(info.containerUptimeSeconds)
                    : '—'
                }
                sub={
                  info.containerUptimeSeconds == null
                    ? 'Not running in Docker (or unavailable)'
                    : null
                }
              />
            </div>
          ) : null}
        </SettingsSection>

        <SettingsSection title="Host" description="Kernel uptime and CPU load averages.">
          {loading && !info ? (
            <p className="text-sm text-faint">Loading…</p>
          ) : info ? (
            <div>
              <SystemStat
                label="Hostname"
                value={info.hostname}
                sub={`${info.platform} · ${info.arch}`}
              />
              <SystemStat label="Host uptime" value={formatUptime(info.uptimeSeconds)} />
              <SystemStat
                label="CPU"
                value={`${info.cpu.count} core${info.cpu.count === 1 ? '' : 's'}`}
                sub={[
                  info.cpu.model,
                  info.cpu.speedMhz ? `${info.cpu.speedMhz} MHz` : null,
                  loadAvg?.length ? `Load ${loadAvg.map((n) => n.toFixed(2)).join(' / ')}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </div>
          ) : null}
        </SettingsSection>

        {info && mem ? (
          <SettingsSection title="Memory">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-fg-muted">Used</span>
                <span className="text-heading">
                  {formatBytes(mem.usedBytes)} / {formatBytes(mem.totalBytes)}
                </span>
              </div>
              <UsageMeter used={mem.usedBytes} total={mem.totalBytes} />
              <p className="text-xs text-faint">
                {formatBytes(mem.freeBytes)} free for the OS and other processes
              </p>
            </div>
          </SettingsSection>
        ) : null}

        {info && disk ? (
          <SettingsSection title="Disk">
            <div className="space-y-2">
              <p className="text-xs text-faint font-mono break-all">{disk.path}</p>
              <div className="flex justify-between text-sm">
                <span className="text-fg-muted">Used</span>
                <span className="text-heading">
                  {formatBytes(disk.totalBytes - disk.availableBytes)} /{' '}
                  {formatBytes(disk.totalBytes)}
                </span>
              </div>
              <UsageMeter used={disk.totalBytes - disk.availableBytes} total={disk.totalBytes} />
              <p className="text-xs text-faint">
                {formatBytes(disk.availableBytes)} available on this filesystem
              </p>
            </div>
          </SettingsSection>
        ) : null}
      </div>
    </div>
  );
}
