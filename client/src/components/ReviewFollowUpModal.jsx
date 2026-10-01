import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import AutoGrowTextarea from './AutoGrowTextarea.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';
import { handleComposerEnterKeyDown } from '../utils/composerEnterSubmit.js';
import { TEXT_MUTED } from '../utils/ui.js';

const PLACEHOLDER = 'Message to send to the reviewer…';

export default function ReviewFollowUpModal({ onConfirm, onCancel, submitting }) {
  const [message, setMessage] = useState('');
  const trimmed = message.trim();
  const canSubmit = Boolean(trimmed) && !submitting;

  const handleConfirm = () => {
    if (!canSubmit) return;
    onConfirm(trimmed);
  };

  const handleKeyDown = (e) => {
    handleComposerEnterKeyDown(e, {
      disabled: submitting,
      canSubmit: Boolean(trimmed),
      onSubmit: handleConfirm,
    });
  };

  return (
    <Modal maxWidth="max-w-md">
      <ModalHeader
        title="Send a follow-up message"
        icon={MessageSquare}
        onClose={onCancel}
        disabled={submitting}
      />
      <label className="block">
        <span className={`${TEXT_MUTED} text-sm mb-1.5 block`}>Message</span>
        <AutoGrowTextarea
          rows={4}
          maxHeightPx={240}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDER}
          disabled={submitting}
          className="block w-full rounded-lg border border-strong bg-control px-3 py-2.5 text-sm text-fg placeholder-faint focus:outline-none focus:ring-2 focus:ring-brand/50 resize-none"
          autoFocus
        />
      </label>
      <ModalActions>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className={GHOST_BUTTON_CLASS}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canSubmit}
          className={PRIMARY_BUTTON_SIZED}
        >
          {submitting ? 'Sending…' : 'Send'}
        </button>
      </ModalActions>
    </Modal>
  );
}
