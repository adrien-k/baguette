import { X, AlertTriangle } from 'lucide-react';

export default function ArchiveUnpushedWarningModal({
  commitsToPush,
  onConfirm,
  onCancel,
  loading,
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-white font-semibold">Archive session?</h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="text-zinc-500 hover:text-zinc-300 p-1 -m-1 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-950/30 border border-amber-500/20 rounded-lg px-3 py-2 mb-4">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            This session has{' '}
            <strong>
              {commitsToPush} unpushed commit{commitsToPush !== 1 ? 's' : ''}
            </strong>
            . Archiving removes the worktree and those commits will only exist locally until you push
            from another clone.
          </span>
        </div>

        <p className="text-zinc-500 text-xs mb-6">
          Push from the session header or ask the agent to push before archiving if you still need
          these changes on GitHub.
        </p>

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm text-zinc-300 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors"
          >
            {loading ? 'Archiving…' : 'Archive anyway'}
          </button>
        </div>
      </div>
    </div>
  );
}
