import { useMemo, useState } from 'react';
import { Loader2, Plus, Square, Trash2 } from 'lucide-react';
import { useSessionAgents } from '../../hooks/useSessionAgents.js';
import { agentsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import {
  agentDisplayTitle,
  canRemoveAgentWhenIdle,
  isAgentTurnActive,
  isPrimaryAgent,
  isSubagentBuilder,
  sortSessionAgentsByRefAsc,
} from '../../utils/sessionAgents.js';
import AgentTypeIcon from '../../components/AgentTypeIcon.jsx';
import AgentMainBadge from '../../components/AgentMainBadge.jsx';
import ClearReviewerChatConfirmModal from '../../components/ClearReviewerChatConfirmModal.jsx';
import DeleteAgentConfirmModal from '../../components/DeleteAgentConfirmModal.jsx';
import { PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';

function statusLabel(status) {
  if (!status) return '—';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function AgentListRow({
  agent,
  selected,
  readonly,
  actionAgentId,
  onSelectAgent,
  onRequestClearReviewer,
  onStopAgent,
  onRequestDeleteAgent,
}) {
  const subagent = isSubagentBuilder(agent);
  const showClearReviewer =
    !readonly && agent.agent_type === 'reviewer' && canRemoveAgentWhenIdle(agent);
  const showDeleteBuilder =
    !readonly &&
    (agent.agent_type === 'builder' || agent.agent_type === 'subagent') &&
    canRemoveAgentWhenIdle(agent);
  const showStop = !readonly && isAgentTurnActive(agent.status);
  const busy = actionAgentId === agent.id;

  return (
    <li>
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
            <AgentTypeIcon agentType={agent.agent_type} subagent={subagent} />
            {agent.ref != null ? (
              <span className="text-faint font-mono text-[11px] shrink-0">#{agent.ref}</span>
            ) : null}
            <span className="text-sm font-medium text-heading truncate">
              {agentDisplayTitle(agent)}
            </span>
            {isPrimaryAgent(agent) ? <AgentMainBadge /> : null}
          </div>
          <p className="text-[11px] text-faint mt-0.5">{statusLabel(agent.status)}</p>
        </button>
        {showStop && (
          <button
            type="button"
            title="Stop agent"
            disabled={busy}
            onClick={() => onStopAgent?.(agent)}
            className="shrink-0 px-2 text-faint hover:text-heading disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Square className="w-3.5 h-3.5 fill-current" />
            )}
          </button>
        )}
        {showClearReviewer && (
          <button
            type="button"
            title="Clear reviewer chat"
            disabled={busy}
            onClick={() => onRequestClearReviewer(agent)}
            className="shrink-0 px-2 text-faint hover:text-danger disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        {showDeleteBuilder && (
          <button
            type="button"
            title="Delete agent"
            disabled={busy}
            onClick={() => onRequestDeleteAgent?.(agent)}
            className="shrink-0 px-2 text-faint hover:text-danger disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>
    </li>
  );
}

export default function AgentsPanel({
  sessionId,
  selectedAgentId,
  onSelectAgent,
  onReviewerCleared,
  readonly,
}) {
  const { agents, loading } = useSessionAgents(sessionId);
  const [actionAgentId, setActionAgentId] = useState(null);
  const [pendingClearAgent, setPendingClearAgent] = useState(null);
  const [pendingDeleteAgent, setPendingDeleteAgent] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);

  const mainAgents = useMemo(
    () => sortSessionAgentsByRefAsc(agents.filter((a) => !isSubagentBuilder(a))),
    [agents]
  );
  const subagents = useMemo(
    () => sortSessionAgentsByRefAsc(agents.filter(isSubagentBuilder)),
    [agents]
  );

  const handleAgentRemoved = (agent) => {
    if (selectedAgentId != null && Number(selectedAgentId) === agent.id) {
      if (agent.agent_type === 'reviewer') {
        onReviewerCleared?.();
      } else {
        const primary = agents.find((a) => Number(a.is_primary) === 1);
        if (primary) onSelectAgent?.(primary);
      }
    }
  };

  const requestClearReviewer = (agent) => {
    if (!sessionId || readonly || agent.agent_type !== 'reviewer') return;
    setPendingClearAgent(agent);
  };

  const handleConfirmClearReviewer = async () => {
    const agent = pendingClearAgent;
    if (!sessionId || !agent) return;
    setActionAgentId(agent.id);
    try {
      await agentsService.remove(agent.id);
      setPendingClearAgent(null);
      handleAgentRemoved(agent);
    } catch (err) {
      toastError('Failed to clear reviewer chat', err);
    } finally {
      setActionAgentId(null);
    }
  };

  const handleStopAgent = async (agent) => {
    if (!sessionId || readonly || !isAgentTurnActive(agent.status)) return;
    setActionAgentId(agent.id);
    try {
      await agentsService.stop({ agent_id: agent.id });
    } catch (err) {
      toastError('Failed to stop agent', err);
    } finally {
      setActionAgentId(null);
    }
  };

  const requestDeleteAgent = (agent) => {
    if (!sessionId || readonly || !canRemoveAgentWhenIdle(agent)) return;
    setPendingDeleteAgent(agent);
  };

  const handleConfirmDeleteAgent = async () => {
    const agent = pendingDeleteAgent;
    if (!sessionId || !agent || !canRemoveAgentWhenIdle(agent)) return;
    setActionAgentId(agent.id);
    try {
      await agentsService.remove(agent.id);
      setPendingDeleteAgent(null);
      handleAgentRemoved(agent);
    } catch (err) {
      toastError('Failed to delete agent', err);
    } finally {
      setActionAgentId(null);
    }
  };

  const handleAddBuilder = async () => {
    if (!sessionId || adding) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setAdding(true);
    try {
      const agent = await agentsService.create({
        session_id: sessionId,
        agent_type: 'builder',
        name: trimmedName,
      });
      setShowAddForm(false);
      setName('');
      if (agent?.id != null) {
        onSelectAgent?.(agent);
      }
    } catch (err) {
      toastError('Failed to add builder agent', err);
    } finally {
      setAdding(false);
    }
  };

  if (loading && agents.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-faint" />
      </div>
    );
  }

  const addBuilderForm =
    !readonly && showAddForm ? (
      <div className="space-y-2 rounded-lg border border-line bg-control/30 p-2 mx-2 mb-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-faint">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-line bg-control px-2 py-1.5 text-sm"
            placeholder="e.g. Research"
            autoFocus
          />
        </label>
        <p className="text-[11px] text-faint">
          Uses this session&apos;s agent and model. Send the first message from the composer.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-md border border-line px-2 py-1.5 text-xs text-faint hover:text-heading"
            onClick={() => setShowAddForm(false)}
            disabled={adding}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${PRIMARY_BUTTON_SIZED} flex-1 justify-center`}
            disabled={adding || !name.trim()}
            onClick={handleAddBuilder}
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    ) : null;

  return (
    <>
      {agents.length === 0 ? (
        <p className="px-3 py-4 text-xs text-faint">No agents for this session yet.</p>
      ) : (
        <div className="flex flex-col min-h-0 flex-1 overflow-y-auto">
          <div className="shrink-0">
            {!readonly && !showAddForm && (
              <div className="p-2 border-b border-line/60">
                <button
                  type="button"
                  className={`${PRIMARY_BUTTON_SIZED} w-full justify-center`}
                  onClick={() => setShowAddForm(true)}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add builder
                </button>
              </div>
            )}
            {addBuilderForm}
          </div>

          {mainAgents.length > 0 && (
            <ul className="flex flex-col gap-1 p-2">
              {mainAgents.map((agent) => (
                <AgentListRow
                  key={agent.id}
                  agent={agent}
                  selected={selectedAgentId != null && Number(selectedAgentId) === agent.id}
                  readonly={readonly}
                  actionAgentId={actionAgentId}
                  onSelectAgent={onSelectAgent}
                  onRequestClearReviewer={requestClearReviewer}
                  onStopAgent={handleStopAgent}
                  onRequestDeleteAgent={requestDeleteAgent}
                />
              ))}
            </ul>
          )}

          <div className="border-t border-line/80 mt-1 pt-1 shrink-0">
            <div className="px-3 py-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
                Subagents
              </span>
            </div>
            {subagents.length === 0 ? (
              <p className="px-3 pb-3 text-[11px] text-faint">Started via MCP only.</p>
            ) : (
              <ul className="flex flex-col gap-1 px-2 pb-2">
                {subagents.map((agent) => (
                  <AgentListRow
                    key={agent.id}
                    agent={agent}
                    selected={selectedAgentId != null && Number(selectedAgentId) === agent.id}
                    readonly={readonly}
                    actionAgentId={actionAgentId}
                    onSelectAgent={onSelectAgent}
                    onRequestClearReviewer={requestClearReviewer}
                    onStopAgent={handleStopAgent}
                    onRequestDeleteAgent={requestDeleteAgent}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {pendingClearAgent && (
        <ClearReviewerChatConfirmModal
          loading={actionAgentId === pendingClearAgent.id}
          onCancel={() => {
            if (!actionAgentId) setPendingClearAgent(null);
          }}
          onConfirm={handleConfirmClearReviewer}
        />
      )}
      {pendingDeleteAgent && (
        <DeleteAgentConfirmModal
          agent={pendingDeleteAgent}
          loading={actionAgentId === pendingDeleteAgent.id}
          onCancel={() => {
            if (!actionAgentId) setPendingDeleteAgent(null);
          }}
          onConfirm={handleConfirmDeleteAgent}
        />
      )}
    </>
  );
}
