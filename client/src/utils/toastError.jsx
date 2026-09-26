import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react';
import toast from 'react-hot-toast';

function ErrorToast({ t, label, detail }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`bg-zinc-800 border border-red-900/60 rounded-xl px-4 py-3 shadow-lg w-full max-w-sm transition-all ${t.visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium">{label}</p>
          {detail && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 mt-1 transition-colors"
            >
              {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {open ? 'Hide details' : 'Show details'}
            </button>
          )}
          {open && detail && (
            <pre className="mt-2 text-xs text-red-400 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 overflow-auto max-h-32 whitespace-pre-wrap break-words">
              {detail}
            </pre>
          )}
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

/**
 * Show an error toast with an optional collapsible details section.
 * @param {string} label - Human-readable action label, e.g. "Failed to delete session"
 * @param {Error|null} [err] - The caught error; its message is shown in the collapsible detail
 */
export function toastError(label, err) {
  const detail = err?.message && err.message !== label ? err.message : null;
  toast.custom((t) => <ErrorToast t={t} label={label} detail={detail} />, { duration: 5000 });
}
