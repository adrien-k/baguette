import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';
import { TEXT_SECONDARY } from '../utils/ui.js';

export default function ClearReviewerChatConfirmModal({ onConfirm, onCancel, loading }) {
  return (
    <Modal maxWidth="max-w-md">
      <ModalHeader title="Clear reviewer chat?" onClose={onCancel} disabled={loading} />
      <p className={`text-sm ${TEXT_SECONDARY} mb-4`}>
        Start the next review from a new prompt. Existing issues stay as they are.
      </p>
      <ModalActions>
        <button type="button" onClick={onCancel} disabled={loading} className={GHOST_BUTTON_CLASS}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={PRIMARY_BUTTON_SIZED}
        >
          {loading ? 'Clearing…' : 'Clear reviewer chat'}
        </button>
      </ModalActions>
    </Modal>
  );
}
