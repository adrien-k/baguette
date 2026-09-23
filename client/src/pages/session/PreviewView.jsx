import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Globe, Play, ScrollText, Wifi, Loader2, Square } from 'lucide-react';
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
  stopped: { text: 'Stopped', className: 'text-zinc-500 bg-zinc-800/80 border-zinc-700' },
  starting: { text: 'Starting…', className: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  ready: { text: 'Ready', className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  crashed: { text: 'Crashed', className: 'text-red-300 bg-red-500/10 border-red-500/30' },
};

const actionBtnClass =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-700/80 bg-zinc-800/40 text-xs text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800 transition-colors';

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

function ServiceRow({
  svc,
  readonly,
  ipPublicEnabled,
  onStart,
  onStop,
  onViewLogs,
  starting,
  stopping,
}) {
  const statusMeta = STATUS_LABEL[svc.status] ?? STATUS_LABEL.stopped;
  const isActive = svc.status === 'ready' || svc.status === 'starting';
  // Enable Start whenever the expose port is not ready. A stopped/crashed server
  // (or one stuck in "starting") must remain startable.
  const canStart = !readonly && svc.status !== 'ready' && !starting && !stopping;
  const canStop = !readonly && isActive && svc.task_id && !stopping;

  const previewUrl = svc.deep_link_url || svc.url;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="mb-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-zinc-100">{svc.display_name}</span>
              <span
                className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border ${statusMeta.className}`}
              >
                {statusMeta.text}
              </span>
              {svc.status === 'starting' && (
                <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              )}
            </div>
            {svc.description && (
              <p className="text-xs text-zinc-500 mt-1 leading-relaxed max-w-prose whitespace-pre-wrap">
                {svc.description}
              </p>
            )}
          </div>
          {ipPublicEnabled && isActive && svc.allowed_ip && (
            <p className="text-xs text-zinc-500 mt-2">
              Allowed IP <span className="font-mono text-zinc-400">{svc.allowed_ip}</span>
            </p>
          )}
          {svc.exit_code != null && svc.status === 'crashed' && (
            <p className="text-xs text-red-400/80 mt-1">Exit code {svc.exit_code}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${actionBtnClass} text-sky-300 hover:text-sky-200 hover:border-sky-500/30`}
            >
              Open preview
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
        <div className="flex items-start gap-2 shrink-0">
          <ServiceQrCode url={previewUrl} />
          {!readonly && canStop && (
            <button
              type="button"
              onClick={() => onStop(svc.task_id)}
              className={actionBtnClass}
              title="Stop preview service"
            >
              <Square className="w-3.5 h-3.5 fill-current text-red-400" />
              Stop
            </button>
          )}
          {!readonly && canStart && (
            <button
              type="button"
              onClick={() => onStart(svc.name)}
              className={actionBtnClass}
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
            className={`${actionBtnClass} disabled:opacity-40 disabled:cursor-not-allowed`}
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
        <header className="space-y-1">
          <h1 className="text-lg font-semibold text-zinc-100 tracking-tight">Preview</h1>
          <p className="text-sm text-zinc-500">
            Start dev servers on demand and share preview links. Optional descriptions come from{' '}
            <code className="text-zinc-400 text-xs">.baguette.yaml</code>.
          </p>
        </header>

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
                stopping={svc.task_id != null && stoppingTaskId === svc.task_id}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
