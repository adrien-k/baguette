import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Globe, Play, ScrollText, Wifi, Copy, Loader2, Square } from 'lucide-react';
import toast from 'react-hot-toast';
import QRCode from 'react-qr-code';
import { toastError } from '../../utils/toastError.jsx';
import { sessionsService, tasksService } from '../../feathers.js';

function ServiceQrCode({ url }) {
  if (!url) return null;
  return (
    <div
      className="shrink-0 rounded-md border border-zinc-700 bg-white p-1.5"
      title={url}
      aria-label={`QR code: ${url}`}
    >
      <QRCode value={url} size={68} level="M" />
    </div>
  );
}

const STATUS_LABEL = {
  stopped: { text: 'Stopped', className: 'text-zinc-500' },
  starting: { text: 'Starting…', className: 'text-amber-400' },
  ready: { text: 'Ready', className: 'text-emerald-400' },
  crashed: { text: 'Crashed', className: 'text-red-400' },
};

function PreviewSettingsToggles({ session }) {
  if (!session?.preview_url) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Preview access</h2>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="w-4 h-4 text-zinc-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-zinc-300">Public preview</h3>
            <p className="text-xs text-zinc-500">
              Anyone with the link can open the preview and start the dev server.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!session?.is_preview_public}
          onClick={() => {
            if (!session?.id) return;
            sessionsService
              .patch(session.id, { is_preview_public: !session.is_preview_public })
              .catch((err) => toastError('Failed to update public preview setting', err));
          }}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${session?.is_preview_public ? 'bg-amber-500' : 'bg-zinc-600'}`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${session?.is_preview_public ? 'translate-x-4.5' : 'translate-x-0.5'}`}
          />
        </button>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Wifi className="w-4 h-4 text-zinc-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-zinc-300">IP-public preview</h3>
            <p className="text-xs text-zinc-500">
              Sign in to start the dev server; once running, the same IP can use the preview without
              signing in.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!session?.is_preview_ip_public}
          onClick={() => {
            if (!session?.id) return;
            sessionsService
              .patch(session.id, { is_preview_ip_public: !session.is_preview_ip_public })
              .catch((err) => toastError('Failed to update IP-public preview setting', err));
          }}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${session?.is_preview_ip_public ? 'bg-amber-500' : 'bg-zinc-600'}`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${session?.is_preview_ip_public ? 'translate-x-4.5' : 'translate-x-0.5'}`}
          />
        </button>
      </div>
    </div>
  );
}

function ServiceRow({ svc, readonly, ipPublicEnabled, onStart, onStop, onViewLogs, starting, stopping }) {
  const statusMeta = STATUS_LABEL[svc.status] ?? STATUS_LABEL.stopped;
  const isActive = svc.status === 'ready' || svc.status === 'starting';
  const canStart = !readonly && !isActive && !starting && !stopping;
  const canStop = !readonly && isActive && svc.task_id && !stopping;

  const copyLink = (url, label) => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    toast.success(`${label} copied`);
  };

  const qrUrl = svc.deep_link_url || svc.url;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-200">{svc.display_name}</span>
            <span className={`text-xs ${statusMeta.className}`}>{statusMeta.text}</span>
            {svc.status === 'starting' && (
              <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            )}
            {ipPublicEnabled && isActive && svc.allowed_ip && (
              <span className="text-xs text-zinc-500">
                Allowed IP{' '}
                <span className="font-mono text-zinc-400">{svc.allowed_ip}</span>
              </span>
            )}
          </div>
          {svc.exit_code != null && svc.status === 'crashed' && (
            <p className="text-xs text-red-400/80 mt-0.5">Exit code {svc.exit_code}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <a
              href={svc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
            >
              Open preview
              <ExternalLink className="w-3 h-3" />
            </a>
            {svc.deep_link_url && (
              <button
                type="button"
                onClick={() => copyLink(svc.deep_link_url, 'Deep link')}
                className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-300"
              >
                <Copy className="w-3 h-3" />
                Deep link
              </button>
            )}
          </div>
          {svc.deep_link_url && (
            <code className="mt-1 block text-[10px] text-zinc-600 truncate">
              {svc.deep_link_url}
            </code>
          )}
        </div>
        <div className="flex items-start gap-2 shrink-0">
          <ServiceQrCode url={qrUrl} />
          {!readonly && canStop && (
            <button
              type="button"
              onClick={() => onStop(svc.task_id)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-zinc-700 text-xs text-zinc-300 hover:border-zinc-600"
              title="Stop preview service"
            >
              <Square className="w-3.5 h-3.5 fill-current text-red-400" />
              Stop
            </button>
          )}
          {!readonly && !canStop && (
            <button
              type="button"
              disabled={!canStart}
              onClick={() => onStart(svc.name)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-zinc-700 text-xs text-zinc-300 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Start preview service (1 hour idle timeout)"
            >
              <Play className="w-3.5 h-3.5 text-emerald-400" />
              Start
            </button>
          )}
          <button
            type="button"
            disabled={!svc.task_id}
            onClick={() => svc.task_id && onViewLogs(svc.task_id)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-zinc-700 text-xs text-zinc-300 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ScrollText className="w-3.5 h-3.5" />
            Logs
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PreviewView({ session, readonly, onViewLogs }) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startingService, setStartingService] = useState(null);
  const [stoppingTaskId, setStoppingTaskId] = useState(null);

  const refreshStatus = useCallback(() => {
    if (!session?.id) return;
    sessionsService
      .previewStatus({ id: session.id })
      .then((res) => setServices(res.services ?? []))
      .catch((err) => toastError('Failed to load preview status', err))
      .finally(() => setLoading(false));
  }, [session]);

  useEffect(() => {
    setLoading(true);
    refreshStatus();
    const interval = setInterval(refreshStatus, 4000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  const handleStart = async (serviceName) => {
    if (!session?.id) return;
    setStartingService(serviceName);
    try {
      await sessionsService.startPreviewService({ id: session.id, service: serviceName });
      refreshStatus();
    } catch (err) {
      toastError('Failed to start preview service', err);
    } finally {
      setStartingService(null);
    }
  };

  const handleStop = async (taskId) => {
    if (!taskId) return;
    setStoppingTaskId(taskId);
    try {
      await tasksService.kill(taskId);
      refreshStatus();
    } catch (err) {
      toastError('Failed to stop preview service', err);
    } finally {
      setStoppingTaskId(null);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <PreviewSettingsToggles session={session} />

        <div className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Services</h2>
          {loading && services.length === 0 ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : services.length === 0 ? (
            <p className="text-sm text-zinc-500">No preview services configured.</p>
          ) : (
            services.map((svc) => (
              <ServiceRow
                key={svc.name}
                svc={svc}
                readonly={readonly}
                ipPublicEnabled={!!session?.is_preview_ip_public}
                onStart={handleStart}
                onStop={handleStop}
                onViewLogs={onViewLogs}
                starting={startingService === svc.name}
                stopping={stoppingTaskId === svc.task_id}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
