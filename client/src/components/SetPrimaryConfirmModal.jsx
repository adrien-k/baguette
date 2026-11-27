import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import { GHOST_BUTTON_CLASS } from '../utils/buttonStyles.js';
import { TEXT_SECONDARY } from '../utils/ui.js';
import { agentDisplayTitle } from '../utils/sessionAgents.js';

export default function SetPrimaryConfirmModal({ agent, onConfirm, onCancel, loading }) {
  const title = agent ? agentDisplayTitle(agent) : 'this builder';

  return (
    <Modal>
      <ModalHeader title="Make primary builder?" onClose={onCancel} disabled={loading} />

      <p className={`text-sm ${TEXT_SECONDARY} mb-3`}>
        <span className="font-medium text-heading">{title}</span> will become this session&apos;s
        primary builder.
      </p>

      <ul className={`list-disc pl-5 space-y-1.5 text-sm ${TEXT_SECONDARY} mb-4`}>
        <li>
          Messages sent without picking an agent, and MCP tools that omit <code>agent_ref</code>, go
          to the primary builder.
        </li>
        <li>
          Session-level waits such as <code>AwaitSessionTurn</code> track the primary builder&apos;s
          turn.
        </li>
        <li>
          The current primary builder becomes a secondary builder. Its chat history is unchanged.
        </li>
        <li>Subagents stay attached to the builder that started them.</li>
      </ul>

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
          {loading ? 'Switching…' : 'Make primary'}
        </button>
      </ModalActions>
    </Modal>
  );
}
