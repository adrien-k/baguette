import { AlertCircle, Loader2, X } from 'lucide-react';
import { BANNER_DANGER } from '../../utils/ui.js';

export default function SessionStatusBanners({
  session,
  isArchiving,
  isReadonly,
  error,
  onDismissError,
}) {
  return (
    <>
      {session && isArchiving && (
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-control/80 border-b border-strong text-fg-muted text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-accent/80" />
          <span>Archiving session — removing worktree…</span>
        </div>
      )}
      {session && isReadonly && session.archived_at && (
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-control/80 border-b border-strong text-fg-muted text-xs">
          <span>This session has been deleted — read only</span>
        </div>
      )}

      {error && (
        <div
          className={`shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 rounded-none border-x-0 border-t-0 ${BANNER_DANGER} text-sm`}
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-0">{error}</span>
          <button
            type="button"
            onClick={onDismissError}
            className="shrink-0 p-1 rounded hover:bg-danger/50 text-danger"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </>
  );
}
