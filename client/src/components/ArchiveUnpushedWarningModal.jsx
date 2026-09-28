import { AlertTriangle } from 'lucide-react';
import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import { GHOST_BUTTON_CLASS } from '../utils/buttonStyles.js';
import { TEXT_FAINT, TINT_WARN_SOFT } from '../utils/ui.js';

export default function ArchiveUnpushedWarningModal({
  commitsToPush,
  onConfirm,
  onCancel,
  loading,
}) {
  return (
    <Modal>
      <ModalHeader title="Archive session?" onClose={onCancel} disabled={loading} />

      <div className={`flex items-start gap-2 text-xs ${TINT_WARN_SOFT} rounded-lg px-3 py-2 mb-4`}>
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

      <p className={`${TEXT_FAINT} text-xs`}>
        Push from the session header or ask the agent to push before archiving if you still need
        these changes on GitHub.
      </p>

      <ModalActions>
        <button type="button" onClick={onCancel} disabled={loading} className={GHOST_BUTTON_CLASS}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="px-4 py-2 text-sm bg-brand hover:bg-brand-hover disabled:bg-disabled disabled:text-faint text-on-brand font-medium rounded-lg transition-colors"
        >
          {loading ? 'Archiving…' : 'Archive anyway'}
        </button>
      </ModalActions>
    </Modal>
  );
}
