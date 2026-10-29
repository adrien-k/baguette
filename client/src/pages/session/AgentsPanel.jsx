import { useMemo, useRef, useState } from 'react';
import { Loader2, Pencil, Square, Trash2 } from 'lucide-react';
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
import { useSessionUsage } from '../../hooks/useSessionUsage.js';
import { formatAgentUsageCostLabel, usageCostByAgentId } from '../../utils/usageSeries.js';

function statusLabel(status) {
  if (!status) return '—';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function AgentListRow({
  agent,
  selected,
  readonly,
  actionAgentId,
  costLabel,
  renaming,
  renameValue,
  renameSaving,
  onSelectAgent,
  onStartRename,
  onRenameChange,
  onCommitRename,
  onCancelRename,
  onRequestClearReviewer,
  onStopAgent,
  onRequestDeleteAgent,
}) {
  const subagent = isSubagentBuilder(agent);
  const canRename =
    !readonly &&
    !isPrimaryAgent(agent) &&
    (agent.agent_type === 'builder' || agent.agent_type === 'subagent');
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
            {renaming ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => onRenameChange?.(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onCommitRename?.(agent);
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancelRename?.();
                  }
                }}
                onBlur={() => onCommitRename?.(agent)}
                disabled={renameSaving}
                className="flex-1 min-w-0 rounded border border-line bg-control px-1.5 py-0.5 text-sm text-heading"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="text-sm font-medium text-heading truncate">
                {agentDisplayTitle(agent)}
              </span>
            )}
            {isPrimaryAgent(agent) ? <AgentMainBadge /> : null}
          </div>
          <p className="text-[11px] text-faint mt-0.5">
            {statusLabel(agent.status)}
            {costLabel ? <span className="tabular-nums">{` ${costLabel}`}</span> : null}
          </p>
        </button>
        {canRename && !renaming && (
          <button
            type="button"
            title="Rename agent"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onStartRename?.(agent);
            }}
            className="shrink-0 px-2 text-faint hover:text-heading disabled:opacity-50"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
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
  const { usage } = useSessionUsage(sessionId);
  const costByAgentId = useMemo(() => usageCostByAgentId(usage?.by_agent), [usage?.by_agent]);

  const costLabelForAgent = (agent) =>
    formatAgentUsageCostLabel({ agentCost: costByAgentId.get(agent.id) ?? 0 });
  const [actionAgentId, setActionAgentId] = useState(null);
  const [pendingClearAgent, setPendingClearAgent] = useState(null);
  const [pendingDeleteAgent, setPendingDeleteAgent] = useState(null);
  const [renamingAgentId, setRenamingAgentId] = useState(null);
  const renamingAgentIdRef = useRef(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

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

  const startRename = (agent) => {
    if (readonly || isPrimaryAgent(agent)) return;
    renamingAgentIdRef.current = agent.id;
    setRenamingAgentId(agent.id);
    setRenameValue(agent.name?.trim() || agentDisplayTitle(agent));
  };

  const cancelRename = () => {
    if (renameSaving) return;
    renamingAgentIdRef.current = null;
    setRenamingAgentId(null);
    setRenameValue('');
  };

  const commitRename = async (agent) => {
    if (!sessionId || renameSaving || renamingAgentId !== agent.id) return;
    const trimmed = renameValue.trim();
    const current = agent.name?.trim() || '';
    const targetId = agent.id;
    if (!trimmed || trimmed === current) {
      if (renamingAgentIdRef.current === targetId) cancelRename();
      return;
    }
    setRenameSaving(true);
    try {
      await agentsService.patch(targetId, { name: trimmed });
      if (renamingAgentIdRef.current === targetId) cancelRename();
    } catch (err) {
      toastError('Failed to rename agent', err);
    } finally {
      setRenameSaving(false);
    }
  };

  if (loading && agents.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-faint" />
      </div>
    );
  }

  return (
    <>
      {agents.length === 0 ? (
        <p className="px-3 py-4 text-xs text-faint">No agents for this session yet.</p>
      ) : (
        <div className="flex flex-col min-h-0 flex-1 overflow-y-auto">
          {mainAgents.length > 0 && (
            <ul className="flex flex-col gap-1 p-2">
              {mainAgents.map((agent) => (
                <AgentListRow
                  key={agent.id}
                  agent={agent}
                  selected={selectedAgentId != null && Number(selectedAgentId) === agent.id}
                  readonly={readonly}
                  actionAgentId={actionAgentId}
                  costLabel={costLabelForAgent(agent)}
                  renaming={renamingAgentId === agent.id}
                  renameValue={renameValue}
                  renameSaving={renameSaving}
                  onSelectAgent={onSelectAgent}
                  onStartRename={startRename}
                  onRenameChange={setRenameValue}
                  onCommitRename={commitRename}
                  onCancelRename={cancelRename}
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
                    costLabel={costLabelForAgent(agent)}
                    renaming={renamingAgentId === agent.id}
                    renameValue={renameValue}
                    renameSaving={renameSaving}
                    onSelectAgent={onSelectAgent}
                    onStartRename={startRename}
                    onRenameChange={setRenameValue}
                    onCommitRename={commitRename}
                    onCancelRename={cancelRename}
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
