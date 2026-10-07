import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';
import { TEXT_SECONDARY } from '../utils/ui.js';

export default function TaskConfirmModal({
  taskLabel,
  description,
  runPreview,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal maxWidth="max-w-md">
      <ModalHeader title={`Run ${taskLabel}?`} onClose={onCancel} />
      <p className={`text-sm ${TEXT_SECONDARY} mb-3`}>
        {description?.trim() ||
          'This task will run in the session worktree with the session environment.'}
      </p>
      {runPreview ? (
        <pre className="text-xs font-mono text-secondary bg-control border border-line rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
          {runPreview}
        </pre>
      ) : null}
      <ModalActions>
        <button type="button" onClick={onCancel} className={GHOST_BUTTON_CLASS}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className={PRIMARY_BUTTON_SIZED}>
          Run
        </button>
      </ModalActions>
    </Modal>
  );
}
