import { RotateCw, WifiOff, X } from 'lucide-react';
import toast from 'react-hot-toast';

// Single id so a lost/restored flap replaces the toast instead of stacking.
const TOAST_ID = 'sse-connection';

function ConnectionToast({ t, tone, label, detail }) {
  const accent = tone === 'lost' ? 'border-amber-900/60' : 'border-zinc-700';
  const iconColor = tone === 'lost' ? 'text-amber-400' : 'text-zinc-400';

  return (
    <div
      className={`bg-zinc-800 border ${accent} rounded-xl px-4 py-3 shadow-lg w-full max-w-sm transition-all ${t.visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="flex items-start gap-3">
        <WifiOff className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} />
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium">{label}</p>
          <p className="text-xs text-zinc-400 mt-0.5">{detail}</p>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 text-xs text-white bg-zinc-700 hover:bg-zinc-600 rounded-lg px-2.5 py-1.5 mt-2 transition-colors"
          >
            <RotateCw className="w-3 h-3" />
            Reload page
          </button>
        </div>
        <button
          onClick={() => toast.dismiss(t.id)}
          className="text-zinc-500 hover:text-zinc-300 shrink-0 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function dismissConnectionToast() {
  toast.dismiss(TOAST_ID);
}

/** Live updates have stopped; stays up until the connection returns or the user acts. */
export function showConnectionLostToast() {
  toast.custom(
    (t) => (
      <ConnectionToast
        t={t}
        tone="lost"
        label="Connection lost"
        detail="Live updates have stopped. Reload the page to reconnect."
      />
    ),
    { id: TOAST_ID, duration: Infinity }
  );
}

/** Reconnected — but events sent while we were offline were missed, so still offer a reload. */
export function showConnectionRestoredToast() {
  toast.custom(
    (t) => (
      <ConnectionToast
        t={t}
        tone="restored"
        label="Connection restored"
        detail="Updates from while you were offline may be missing."
      />
    ),
    { id: TOAST_ID, duration: 8000 }
  );
}
