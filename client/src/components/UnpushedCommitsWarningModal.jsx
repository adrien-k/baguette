import { AlertTriangle } from 'lucide-react';
import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import { GHOST_BUTTON_CLASS } from '../utils/buttonStyles.js';
import { TEXT_FAINT, TINT_WARN_SOFT } from '../utils/ui.js';

const COPY = {
  archive: {
    title: 'Archive session?',
    consequence:
      'Archiving removes the worktree and those commits will only exist locally until you push from another clone.',
    hint: 'Push from the session header or ask the agent to push before archiving if you still need these changes on GitHub.',
    confirm: 'Archive anyway',
    confirmLoading: 'Archiving…',
  },
  merge: {
    title: 'Merge pull request?',
    consequence:
      'The pull request will not include those commits until you push. Merging now may leave work off the branch that gets merged.',
    hint: 'Push from the session header or ask the agent to push before merging if these changes should be part of the PR.',
    confirm: 'Merge anyway',
    confirmLoading: 'Continuing…',
  },
};

export default function UnpushedCommitsWarningModal({
  variant = 'archive',
  commitsToPush,
  onConfirm,
  onCancel,
  loading,
}) {
  const copy = COPY[variant] ?? COPY.archive;
  const commitLabel = `${commitsToPush} unpushed commit${commitsToPush !== 1 ? 's' : ''}`;

  return (
    <Modal>
      <ModalHeader title={copy.title} onClose={onCancel} disabled={loading} />

      <div className={`flex items-start gap-2 text-xs ${TINT_WARN_SOFT} rounded-lg px-3 py-2 mb-4`}>
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          This session has <strong>{commitLabel}</strong>. {copy.consequence}
        </span>
      </div>

      <p className={`${TEXT_FAINT} text-xs`}>{copy.hint}</p>

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
          {loading ? copy.confirmLoading : copy.confirm}
        </button>
      </ModalActions>
    </Modal>
  );
}
