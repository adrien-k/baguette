import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import { agentMenuOptionLabel } from '../utils/sessionAgents.js';
import { DANGER_BUTTON_CLASS, GHOST_BUTTON_CLASS } from '../utils/buttonStyles.js';
import { TEXT_SECONDARY } from '../utils/ui.js';

export default function DeleteAgentConfirmModal({ agent, onConfirm, onCancel, loading }) {
  const label = agent ? agentMenuOptionLabel(agent) : 'this agent';

  return (
    <Modal maxWidth="max-w-md">
      <ModalHeader title="Delete agent?" onClose={onCancel} disabled={loading} />
      <p className={`text-sm ${TEXT_SECONDARY} mb-4`}>
        Remove <span className="font-medium text-heading">{label}</span> from this session? This
        cannot be undone. Usage for this agent stays on the Usage page.
      </p>
      <ModalActions>
        <button type="button" onClick={onCancel} disabled={loading} className={GHOST_BUTTON_CLASS}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={DANGER_BUTTON_CLASS}
        >
          {loading ? 'Deleting…' : 'Delete agent'}
        </button>
      </ModalActions>
    </Modal>
  );
}
