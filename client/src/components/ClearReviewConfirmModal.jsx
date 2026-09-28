import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';
import { TEXT_FAINT, TEXT_MUTED } from '../utils/ui.js';

export default function ClearReviewConfirmModal({ onConfirm, onCancel, loading }) {
  return (
    <Modal>
      <ModalHeader title="Review the entire session" onClose={onCancel} disabled={loading} />
      <p className={`${TEXT_MUTED} text-sm mb-1`}>
        This clears reviewer chat history and resets the last-reviewed commit marker. The next
        review will evaluate the full session diff from the start.
      </p>
      <p className={`${TEXT_FAINT} text-xs mb-0`}>Issues on this tab are unchanged.</p>
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
          {loading ? 'Starting…' : 'Review entire session'}
        </button>
      </ModalActions>
    </Modal>
  );
}
