import { useState } from 'react';
import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import UnpushedCommitsWarning from './UnpushedCommitsWarning.jsx';
import { GHOST_BUTTON_CLASS } from '../utils/buttonStyles.js';
import { TEXT_SECONDARY } from '../utils/ui.js';

export default function ArchiveConfirmModal({
  prNumber,
  commitsToPush = 0,
  onConfirm,
  onCancel,
  loading,
}) {
  const hasDraftPr = prNumber != null;
  const [closePr, setClosePr] = useState(true);
  const hasUnpushed = commitsToPush > 0;

  const handleConfirm = () => {
    onConfirm({ closePr: hasDraftPr && closePr });
  };

  return (
    <Modal>
      <ModalHeader title="Archive session?" onClose={onCancel} disabled={loading} />

      <UnpushedCommitsWarning
        commitsToPush={commitsToPush}
        consequence="Archiving removes the worktree and those commits will only exist locally until you push from another clone."
        hint="Push from the session header or ask the agent to push before archiving if you still need these changes on GitHub."
      />

      {hasDraftPr && (
        <label className="flex items-start gap-2.5 mb-4 cursor-pointer group">
          <input
            type="checkbox"
            checked={closePr}
            onChange={(e) => setClosePr(e.target.checked)}
            disabled={loading}
            className="mt-0.5 rounded border-strong bg-control text-brand focus:ring-brand/50"
          />
          <span className={`text-sm ${TEXT_SECONDARY} group-hover:text-heading`}>
            Close draft pull request #{prNumber}
          </span>
        </label>
      )}

      <ModalActions>
        <button type="button" onClick={onCancel} disabled={loading} className={GHOST_BUTTON_CLASS}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={loading}
          className="px-4 py-2 text-sm bg-brand hover:bg-brand-hover disabled:bg-disabled disabled:text-faint text-on-brand font-medium rounded-lg transition-colors"
        >
          {loading ? 'Archiving…' : hasUnpushed ? 'Archive anyway' : 'Archive'}
        </button>
      </ModalActions>
    </Modal>
  );
}
