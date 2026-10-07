import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import { GHOST_BUTTON_CLASS } from '../utils/buttonStyles.js';
import { TEXT_FAINT, TEXT_MUTED } from '../utils/ui.js';
import { formatAgentSdkDisplayName } from '@baguette/shared/agent-sdk-display.js';

export default function SwitchAgentSdkConfirmModal({
  fromSdk,
  toSdk,
  onConfirm,
  onCancel,
  loading = false,
}) {
  const fromLabel = formatAgentSdkDisplayName(fromSdk);
  const toLabel = formatAgentSdkDisplayName(toSdk);

  return (
    <Modal>
      <ModalHeader title="Switch agent SDK" onClose={onCancel} />
      <p className={`${TEXT_MUTED} text-sm mb-2`}>
        Switch from <span className="font-medium text-heading">{fromLabel}</span> to{' '}
        <span className="font-medium text-heading">{toLabel}</span>?
      </p>
      <p className={`${TEXT_FAINT} text-xs mb-1`}>
        The next turn starts with a fresh context—the new SDK will not carry over the prior
        provider-side conversation history.
      </p>
      <p className={`${TEXT_FAINT} text-xs mb-4`}>
        Your messages stay in this session. The agent can read earlier turns with the{' '}
        <span className="font-mono text-fg-muted">GetSessionMessages</span> MCP tool when needed.
      </p>
      <ModalActions>
        <button type="button" onClick={onCancel} disabled={loading} className={GHOST_BUTTON_CLASS}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-brand hover:bg-brand-hover disabled:bg-disabled disabled:text-faint text-white font-medium rounded-lg transition-colors"
        >
          {loading && (
            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          )}
          Switch SDK
        </button>
      </ModalActions>
    </Modal>
  );
}
