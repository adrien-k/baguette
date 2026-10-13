import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { useSessionAgents } from '../../hooks/useSessionAgents.js';
import { agentsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import {
  agentDisplayTitle,
  agentShowsTypeBadge,
  isAgentTurnActive,
} from '../../utils/sessionAgents.js';
import AgentTypeBadge from '../../components/AgentTypeBadge.jsx';
import AgentTypeIcon from '../../components/AgentTypeIcon.jsx';
import ClearReviewerChatConfirmModal from '../../components/ClearReviewerChatConfirmModal.jsx';

function statusLabel(status) {
  if (!status) return '—';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function AgentsPanel({
  sessionId,
  selectedAgentId,
  onSelectAgent,
  onReviewerCleared,
  readonly,
}) {
  const { agents, loading } = useSessionAgents(sessionId);
  const [clearingId, setClearingId] = useState(null);
  const [pendingClearAgent, setPendingClearAgent] = useState(null);

  const requestClearReviewer = (agent) => {
    if (!sessionId || readonly || agent.agent_type !== 'reviewer') return;
    setPendingClearAgent(agent);
  };

  const handleConfirmClearReviewer = async () => {
    const agent = pendingClearAgent;
    if (!sessionId || !agent) return;
    setClearingId(agent.id);
    try {
      await agentsService.remove(agent.id);
      setPendingClearAgent(null);
      if (selectedAgentId != null && Number(selectedAgentId) === agent.id) {
        onReviewerCleared?.();
      }
    } catch (err) {
      toastError('Failed to clear reviewer chat', err);
    } finally {
      setClearingId(null);
    }
  };

  if (loading && agents.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-faint" />
      </div>
    );
  }

  if (agents.length === 0) {
    return <p className="px-3 py-4 text-xs text-faint">No agents for this session yet.</p>;
  }

  return (
    <>
      <ul className="flex flex-col gap-1 p-2 overflow-y-auto min-h-0 flex-1">
        {agents.map((agent) => {
          const selected = selectedAgentId != null && Number(selectedAgentId) === agent.id;
          const showClear =
            !readonly && agent.agent_type === 'reviewer' && !isAgentTurnActive(agent.status);
          return (
            <li key={agent.id}>
              <div
                className={`flex items-stretch gap-1 rounded-lg border transition-colors ${
                  selected ? 'border-brand/60 bg-brand/10' : 'border-transparent'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectAgent?.(agent)}
                  className="flex-1 min-w-0 text-left rounded-lg px-3 py-2.5 hover:bg-control/50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AgentTypeIcon agentType={agent.agent_type} />
                    <span className="text-sm font-medium text-heading truncate">
                      {agentDisplayTitle(agent)}
                    </span>
                    {agentShowsTypeBadge(agent) ? (
                      <AgentTypeBadge agentType={agent.agent_type} />
                    ) : null}
                  </div>
                  <p className="text-[11px] text-faint mt-0.5">{statusLabel(agent.status)}</p>
                </button>
                {showClear && (
                  <button
                    type="button"
                    title="Clear reviewer chat"
                    disabled={clearingId === agent.id}
                    onClick={() => requestClearReviewer(agent)}
                    className="shrink-0 px-2 text-faint hover:text-danger disabled:opacity-50"
                  >
                    {clearingId === agent.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {pendingClearAgent && (
        <ClearReviewerChatConfirmModal
          loading={clearingId === pendingClearAgent.id}
          onCancel={() => {
            if (!clearingId) setPendingClearAgent(null);
          }}
          onConfirm={handleConfirmClearReviewer}
        />
      )}
    </>
  );
}
