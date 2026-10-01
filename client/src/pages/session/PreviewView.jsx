import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Globe, ScrollText, Wifi, Loader2, Square, Users } from 'lucide-react';
import QRCode from 'react-qr-code';
import { toastError } from '../../utils/toastError.jsx';
import { sessionsService, tasksService } from '../../feathers.js';
import StartButton from '../../components/StartButton.jsx';
import Toggle from '../../components/Toggle.jsx';
import { SESSION_CONTENT_MAX_WIDTH_CLASS } from '../../components/ChatMessagesViewport.jsx';

function ServiceQrCode({ url }) {
  if (!url) return null;
  return (
    <div
      className="shrink-0 rounded-md border border-strong bg-knob p-1.5"
      title={url}
      aria-label={`QR code: ${url}`}
    >
      <QRCode value={url} size={68} level="M" />
    </div>
  );
}

const STATUS_LABEL = {
  stopped: {
    text: 'Stopped',
    className: 'text-faint bg-control/80 border-strong',
  },
  starting: {
    text: 'Starting…',
    className: 'text-accent bg-brand/10 border-brand/30',
  },
  ready: {
    text: 'Ready',
    className: 'text-success bg-success/10 border-success/30',
  },
  crashed: {
    text: 'Crashed',
    className: 'text-danger bg-danger/10 border-danger/30',
  },
};

const actionBtnClass =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-strong/80 bg-control/40 text-xs text-secondary hover:border-strong hover:bg-control transition-colors';

function PreviewSettingsToggles({ session, compact = false }) {
  if (!session?.preview_url) return null;
  return (
    <div
      className={`rounded-lg border border-line bg-inset/50 space-y-4 ${compact ? 'p-3' : 'p-4'}`}
    >
      <h2 className="text-xs font-medium uppercase tracking-wide text-faint">Preview access</h2>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="w-4 h-4 text-fg-muted shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-secondary">Public preview</h3>
            <p className="text-xs text-faint">
              Anyone with the link can open the preview and start the dev server.
            </p>
          </div>
        </div>
        <Toggle
          size="md"
          checked={!!session?.is_preview_public}
          aria-label="Public preview"
          onChange={(next) => {
            if (!session?.id) return;
            sessionsService
              .patch(session.id, { is_preview_public: next })
              .catch((err) => toastError('Failed to update public preview setting', err));
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="w-4 h-4 text-fg-muted shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-secondary">Baguette users</h3>
            <p className="text-xs text-faint">
              Any signed-in Baguette user can open this preview link (after signing in).
            </p>
          </div>
        </div>
        <Toggle
          size="md"
          checked={session?.is_preview_users_public !== false}
          aria-label="Baguette users"
          onChange={(next) => {
            if (!session?.id) return;
            sessionsService
              .patch(session.id, { is_preview_users_public: next })
              .catch((err) => toastError('Failed to update Baguette users preview setting', err));
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Wifi className="w-4 h-4 text-fg-muted shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-secondary">IP-public preview</h3>
            <p className="text-xs text-faint">
              For previews opened outside a browser (for example Expo Go). The IP that starts the
              server can then use the preview without signing in.
            </p>
          </div>
        </div>
        <Toggle
          size="md"
          checked={!!session?.is_preview_ip_public}
          aria-label="IP-public preview"
          onChange={(next) => {
            if (!session?.id) return;
            sessionsService
              .patch(session.id, { is_preview_ip_public: next })
              .catch((err) => toastError('Failed to update IP-public preview setting', err));
          }}
        />
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
  compact = false,
}) {
  const statusMeta = STATUS_LABEL[svc.status] ?? STATUS_LABEL.stopped;
  const isActive = svc.status === 'ready' || svc.status === 'starting';
  // Enable Start whenever the expose port is not ready. A stopped/crashed server
  // (or one stuck in "starting") must remain startable.
  const canStart = !readonly && svc.status !== 'ready' && !starting && !stopping;
  const canStop = !readonly && isActive && svc.task_id && !stopping;

  const previewUrl = svc.deep_link_url || svc.url;

  return (
    <div className="rounded-xl border border-line bg-inset/60 overflow-hidden shadow-sm">
      <div
        className={`flex flex-wrap items-start justify-between gap-3 ${compact ? 'p-3' : 'p-4 sm:p-5'}`}
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-fg">{svc.display_name}</span>
              <span
                className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border ${statusMeta.className}`}
              >
                {statusMeta.text}
              </span>
              {svc.status === 'starting' && (
                <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
              )}
            </div>
            {svc.description && (
              <p className="text-xs text-faint mt-1 leading-relaxed max-w-prose whitespace-pre-wrap">
                {svc.description}
              </p>
            )}
          </div>
          {ipPublicEnabled && isActive && svc.allowed_ip && (
            <p className="text-xs text-faint mt-2">
              Allowed IP <span className="font-mono text-fg-muted">{svc.allowed_ip}</span>
            </p>
          )}
          {svc.exit_code != null && svc.status === 'crashed' && (
            <p className="text-xs text-danger/80 mt-1">Exit code {svc.exit_code}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${actionBtnClass} text-info hover:text-info hover:border-info/30`}
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
              <Square className="w-3.5 h-3.5 fill-current text-danger" />
              Stop
            </button>
          )}
          {!readonly && canStart && (
            <StartButton onClick={() => onStart(svc.name)} title="Start preview service" />
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

export default function PreviewView({ session, readonly, onViewLogs, compact = false }) {
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
    <div className={`flex-1 min-h-0 overflow-y-auto ${compact ? 'p-3' : 'p-4 sm:p-6'}`}>
      <div className={compact ? 'space-y-4' : `${SESSION_CONTENT_MAX_WIDTH_CLASS} space-y-6`}>
        {!compact && (
          <header className="space-y-1">
            <h1 className="text-lg font-semibold text-fg tracking-tight">Preview</h1>
            <p className="text-sm text-faint">
              Start dev servers on demand and share preview links. Optional descriptions come from{' '}
              <code className="text-fg-muted text-xs">.baguette.yaml</code>.
            </p>
          </header>
        )}

        <PreviewSettingsToggles session={session} compact={compact} />

        <div className="space-y-3">
          {!compact && (
            <h2 className="text-xs font-medium uppercase tracking-wide text-faint">Services</h2>
          )}
          {loading && services.length === 0 ? (
            <p className="text-sm text-faint">Loading…</p>
          ) : services.length === 0 ? (
            <p className="text-sm text-faint">No preview services configured.</p>
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
                compact={compact}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
