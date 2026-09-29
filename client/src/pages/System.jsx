import { useState, useEffect, useCallback } from 'react';
import { toastError } from '../utils/toastError.jsx';
import { apiFetch } from '../api.js';
import SystemWideBadge from '../components/SystemWideBadge.jsx';
import { SettingsSection, SettingsSaveRow } from '../components/SettingsSection.jsx';
import { AllRepositoriesSection } from './settings/GlobalSettingsSections.jsx';
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

function DockerComposeSection() {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [services, setServices] = useState([]);
  const [containers, setContainers] = useState([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);

  const loadContent = () => {
    apiFetch('/api/settings/docker-compose').then((d) => setContent(d.content));
  };

  const loadServices = () => {
    setLoadingServices(true);
    Promise.all([
      apiFetch('/api/settings/docker-compose/services').catch(() => ({ services: [] })),
      apiFetch('/api/settings/docker-compose/containers').catch(() => ({ containers: [] })),
    ])
      .then(([svcData, ctrData]) => {
        setServices(svcData.services || []);
        setContainers(ctrData.containers || []);
      })
      .finally(() => setLoadingServices(false));
  };

  useEffect(() => {
    loadContent();
    loadServices();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await apiFetch('/api/settings/docker-compose', {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      loadServices();
    } catch (err) {
      toastError('Failed to save Docker config', err);
    } finally {
      setSaving(false);
    }
  };

  const handleContainerAction = async (name, action) => {
    setActionLoading(`${name}:${action}`);
    try {
      await apiFetch(`/api/settings/docker-compose/containers/${name}/${action}`, {
        method: 'POST',
      });
      loadServices();
    } catch (err) {
      toastError(`Failed to ${action} container`, err);
    } finally {
      setActionLoading(null);
    }
  };

  const statusColor = (state) => {
    if (!state) return 'bg-track';
    const s = state.toLowerCase();
    if (s.includes('running')) return 'bg-ok';
    if (s.includes('exited') || s.includes('dead')) return 'bg-err';
    if (s.includes('paused') || s.includes('restarting')) return 'bg-brand';
    return 'bg-faint';
  };

  const containerByService = {};
  for (const c of containers) {
    const name = c.Service || c.Name || c.service || c.name;
    if (name) containerByService[name] = c;
  }

  const allServiceNames = [
    ...services,
    ...containers
      .map((c) => c.Service || c.Name || c.service || c.name)
      .filter((n) => n && !services.includes(n)),
  ];

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Docker"
        headerAside={<SystemWideBadge />}
        description="System-wide Docker Compose configuration stored in the data directory. Services defined here are available to all sessions."
      >
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={18}
          spellCheck={false}
          className="w-full bg-nav border border-strong rounded-xl px-4 py-3 text-sm text-fg font-mono placeholder-faint focus:outline-none focus:ring-2 focus:ring-brand/50 resize-y leading-relaxed"
          placeholder="# docker-compose.yml"
        />
        <SettingsSaveRow saving={saving} saved={saved} onSave={handleSave} />
      </SettingsSection>

      <SettingsSection title="Docker services" headerAside={<SystemWideBadge />}>
        <div className="divide-y divide-line">
          {loadingServices && allServiceNames.length === 0 && (
            <p className="text-faint text-sm text-center py-6">Loading…</p>
          )}
          {!loadingServices && allServiceNames.length === 0 && (
            <p className="text-faint text-sm text-center py-6">
              No services defined. Add services to your docker-compose.yml and save.
            </p>
          )}
          {allServiceNames.map((name) => {
            const c = containerByService[name];
            const state = c ? c.State || c.state || '' : '';
            const image = c ? c.Image || c.image || '' : '';
            return (
              <div key={name} className="flex items-center justify-between py-3 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor(state)}`} />
                  <div className="min-w-0">
                    <code className="text-sm text-fg font-medium">{name}</code>
                    <div className="text-xs text-faint mt-0.5 truncate">
                      {image && <span>{image}</span>}
                      {state ? (
                        <span className="ml-2">{state}</span>
                      ) : (
                        <span className="ml-2 italic">not started</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!c && (
                    <button
                      onClick={() => handleContainerAction(name, 'up')}
                      disabled={actionLoading !== null}
                      className="text-xs text-accent hover:text-accent px-2 py-1 rounded hover:bg-control transition-colors disabled:opacity-50"
                    >
                      {actionLoading === `${name}:up` ? '…' : 'Start'}
                    </button>
                  )}
                  {c &&
                    ['start', 'stop', 'restart'].map((action) => (
                      <button
                        key={action}
                        onClick={() => handleContainerAction(name, action)}
                        disabled={actionLoading !== null}
                        className="text-xs text-fg-muted hover:text-fg px-2 py-1 rounded hover:bg-control transition-colors disabled:opacity-50 capitalize"
                      >
                        {actionLoading === `${name}:${action}` ? '…' : action}
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
        {allServiceNames.length > 0 && (
          <div>
            <button
              onClick={loadServices}
              disabled={loadingServices}
              className="text-xs text-faint hover:text-secondary transition-colors"
            >
              {loadingServices ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        )}
      </SettingsSection>
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
          Host resources, every repository registered on this server, and the shared Docker Compose
          stack used by sessions. Disk usage is for the data directory.
        </p>
      </div>

      <div className="space-y-6">
        <SettingsSection
          title="Host"
          description="Refreshed when you open this page or click Refresh."
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
                label="Hostname"
                value={info.hostname}
                sub={`${info.platform} · ${info.arch}`}
              />
              <SystemStat label="Uptime" value={formatUptime(info.uptimeSeconds)} />
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

        <AllRepositoriesSection />
        <DockerComposeSection />
      </div>
    </div>
  );
}
