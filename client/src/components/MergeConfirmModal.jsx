import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import { GHOST_BUTTON_CLASS } from '../utils/buttonStyles.js';
import { TEXT_ACCENT, TEXT_DANGER, TEXT_FAINT, TEXT_MUTED, TEXT_SECONDARY } from '../utils/ui.js';

export default function MergeConfirmModal({
  prNumber,
  onConfirm,
  onCancel,
  loading,
  error,
  onFixConflicts,
}) {
  const [archiveSession, setArchiveSession] = useState(true);

  const handleConfirm = () => {
    onConfirm({ archive: archiveSession });
  };

  return (
    <Modal>
      <ModalHeader title="Merge Pull Request" onClose={onCancel} />
      {error ? (
        <div className="mb-4">
          <div className={`flex items-start gap-2 ${TEXT_DANGER} text-sm mb-3`}>
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
          {onFixConflicts && (
            <button
              type="button"
              onClick={onFixConflicts}
              className="w-full px-3 py-2 text-xs text-left text-secondary hover:text-fg bg-control hover:bg-control-hover border border-strong rounded-lg transition-colors"
            >
              Ask the agent to fix merge conflicts
            </button>
          )}
        </div>
      ) : (
        <>
          <p className={`${TEXT_MUTED} text-sm mb-1`}>
            Merge PR <span className={`${TEXT_ACCENT} font-medium`}>#{prNumber}</span> into the base
            branch?
          </p>
          <p className={`${TEXT_FAINT} text-xs mb-4`}>
            This will squash and merge the changes. This action cannot be undone.
          </p>
          <label className="flex items-start gap-2.5 mb-0 cursor-pointer group">
            <input
              type="checkbox"
              checked={archiveSession}
              onChange={(e) => setArchiveSession(e.target.checked)}
              disabled={loading}
              className="mt-0.5 rounded border-strong bg-control text-ok focus:ring-ok/50"
            />
            <span className={`text-sm ${TEXT_SECONDARY} group-hover:text-heading`}>
              Archive this session after merging
            </span>
          </label>
        </>
      )}
      <ModalActions>
        <button type="button" onClick={onCancel} disabled={loading} className={GHOST_BUTTON_CLASS}>
          {error ? 'Close' : 'Cancel'}
        </button>
        {!error && (
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-ok hover:bg-ok-hover disabled:bg-disabled disabled:text-faint text-white font-medium rounded-lg transition-colors"
          >
            {loading && (
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            Merge
          </button>
        )}
      </ModalActions>
    </Modal>
  );
}
