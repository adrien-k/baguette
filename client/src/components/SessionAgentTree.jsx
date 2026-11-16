import { useState } from 'react';
import { Loader2, MoreHorizontal, Pencil, Square, Trash2 } from 'lucide-react';
import AnchoredMenu from './AnchoredMenu.jsx';
import AgentConfigLogo from './AgentConfigLogo.jsx';
import AgentTypeIcon from './AgentTypeIcon.jsx';
import ClearReviewerChatConfirmModal from './ClearReviewerChatConfirmModal.jsx';
import DeleteAgentConfirmModal from './DeleteAgentConfirmModal.jsx';
import Tooltip from './Tooltip.jsx';
import { SessionStatusIcon } from './SessionCard.jsx';
import { agentsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { formatCompactRelativeTime } from '../utils/dates.js';
import { buildSessionAgentTree } from '../utils/sessionAgentTree.js';
import {
  agentDisplayTitle,
  canRemoveAgentWhenIdle,
  isAgentAwaitingUser,
  isAgentTurnActive,
  isPrimaryAgent,
} from '../utils/sessionAgents.js';
import { messageModelDisplayName } from '../utils/messageModelLabel.js';
import { formatUsd } from '../utils/usageSeries.js';
import { useAgentConfigContext } from '../context/AgentConfigContext.jsx';
import { useAgentConfigModels } from '../hooks/useAgentConfigModels.js';
import { parseModelField } from '../utils/models.js';

const AGENT_MENU_PANEL_CLASS =
  'min-w-[10rem] py-1 bg-surface border border-strong rounded-lg shadow-xl';

function menuRowClass() {
  return 'flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-secondary hover:bg-control-hover/50 hover:text-fg transition-colors';
}

function menuRowDangerClass() {
  return 'flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-danger hover:bg-soft-danger/60 transition-colors';
}

/** Status glyph between agent name and model — hidden for quiet idle rows. */
function AgentTreeStatus({ status }) {
  if (isAgentTurnActive(status) || status === 'provisioning') {
    return <Loader2 className="w-3 h-3 shrink-0 text-success animate-spin" aria-hidden />;
  }
  if (isAgentAwaitingUser(status)) {
    return <SessionStatusIcon status="approval" compact aria-hidden />;
  }
  if (status === 'failed' || status === 'error') {
    return <SessionStatusIcon status="failed" compact aria-hidden />;
  }
  return null;
}

/** Model label for one agent row: catalog display name when available, else the raw id, plus usage cost. */
function AgentTreeModelLabel({ agentConfigId, model, costUsd }) {
  const enabled = agentConfigId != null;
  const { models } = useAgentConfigModels(agentConfigId ?? null, { enabled });
  const cost = Number(costUsd) > 0 ? formatUsd(Number(costUsd)) : null;
  if (!model && !cost) return null;
  const label = model
    ? messageModelDisplayName({ model, models: enabled ? models : [] }) || parseModelField(model)
    : null;
  return (
    <>
      {label && (
        <span className="shrink-0 max-w-[7rem] truncate font-mono text-[10px] text-faint tabular-nums">
          {label}
        </span>
      )}
      {cost && (
        <span className="shrink-0 font-mono text-[10px] text-faint tabular-nums">({cost})</span>
      )}
    </>
  );
}

function AgentTreeActions({
  agent,
  canManage,
  disabled,
  onStop,
  onRequestRename,
  onRequestRemove,
}) {
  const [open, setOpen] = useState(false);
  const canStop = !disabled && isAgentTurnActive(agent.status);
  const canRemove = !disabled && canRemoveAgentWhenIdle(agent);
  const canRename = canManage && !disabled && !isPrimaryAgent(agent);
  if (!canManage || (!canStop && !canRemove && !canRename)) return null;

  const items = [];
  if (canStop) {
    items.push(
      <button key="stop" type="button" className={menuRowClass()} onClick={onStop}>
        <Square className="w-3 h-3 fill-current shrink-0" aria-hidden />
        Stop turn
      </button>
    );
  }
  if (canRename) {
    items.push(
      <button key="rename" type="button" className={menuRowClass()} onClick={onRequestRename}>
        <Pencil className="w-3 h-3 shrink-0" aria-hidden />
        Rename
      </button>
    );
  }
  if (canRemove) {
    items.push(
      <button key="remove" type="button" className={menuRowDangerClass()} onClick={onRequestRemove}>
        <Trash2 className="w-3 h-3 shrink-0" aria-hidden />
        {agent.agent_type === 'reviewer' ? 'Clear reviewer chat' : 'Delete agent'}
      </button>
    );
  }

  return (
    <AnchoredMenu
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      className={AGENT_MENU_PANEL_CLASS}
      reference={({ ref, referenceProps }) => (
        <button
          type="button"
          ref={ref}
          {...referenceProps}
          title="Agent actions"
          aria-label={`Actions for ${agentDisplayTitle(agent)}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            referenceProps.onClick?.(e);
            setOpen((v) => !v);
          }}
          className="shrink-0 p-0.5 rounded text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-fg transition-opacity"
        >
          <MoreHorizontal className="w-3.5 h-3.5" aria-hidden />
        </button>
      )}
    >
      {items}
    </AnchoredMenu>
  );
}

function AgentTreeRow({ node, depth, ...rest }) {
  const { agent, children } = node;
  const { getConfig } = useAgentConfigContext();
  const config = getConfig(agent.agent_config_id);
  const title = agentDisplayTitle(agent);
  const {
    currentAgentId,
    canManage,
    renamingAgentId,
    renameValue,
    renameSaving,
    busyAgentId,
    onSelectAgent,
    onRenameChange,
    onCommitRename,
    onCancelRename,
    onStopAgent,
    onRequestRename,
    onRequestRemove,
  } = rest;
  const isCurrent = currentAgentId != null && Number(currentAgentId) === agent.id;
  const renaming = renamingAgentId === agent.id;
  const busy = busyAgentId === agent.id;
  const time = agent.agent_type === 'subagent' ? null : formatCompactRelativeTime(agent.updated_at);

  return (
    <li>
      <div
        data-testid="agent-tree-row"
        data-agent-name={agent.name || title}
        className={`group flex items-center gap-1.5 rounded-md py-1 pr-1.5 transition-colors ${
          isCurrent ? 'bg-control-hover' : 'hover:bg-control/50'
        }`}
        style={{ paddingLeft: `${1.25 + depth * 1.125}rem` }}
      >
        {config ? (
          <AgentConfigLogo sdk={config.sdk} logo={config.logo} className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <AgentTypeIcon agentType={agent.agent_type} />
        )}
        <button
          type="button"
          onClick={() => onSelectAgent(agent)}
          title={isAgentTurnActive(agent.status) ? 'Turn running' : `Open ${title} chat`}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
        >
          {renaming ? (
            <input
              type="text"
              value={renameValue}
              disabled={renameSaving}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onCommitRename(agent);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancelRename();
                }
              }}
              onBlur={() => onCommitRename(agent)}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 rounded border border-line bg-control px-1.5 py-0.5 text-xs text-heading"
            />
          ) : (
            <span
              className={`min-w-0 truncate text-[11px] ${isCurrent ? 'text-fg' : 'text-secondary'}`}
            >
              {title}
            </span>
          )}
          <AgentTreeStatus status={agent.status} />
        </button>
        <AgentTreeModelLabel
          agentConfigId={agent.agent_config_id}
          model={agent.model}
          costUsd={agent.cost_usd}
        />
        {time && (
          <Tooltip content={agent.updated_at ? new Date(agent.updated_at).toLocaleString() : ''}>
            <span className="shrink-0 w-9 text-right text-[10px] text-faint tabular-nums">
              {time}
            </span>
          </Tooltip>
        )}
        <AgentTreeActions
          agent={agent}
          canManage={canManage}
          disabled={busy}
          onStop={() => onStopAgent(agent)}
          onRequestRename={() => onRequestRename(agent)}
          onRequestRemove={() => onRequestRemove(agent)}
        />
      </div>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <AgentTreeRow key={child.agent.id} node={child} depth={depth + 1} {...rest} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Agent tree for a session row: primary builder at the top, then reviewer
 * and extra builders, with subagents nested under the agent that spawned
 * them. Rows show provider icon · name · status · model · usage cost ·
 * relative time (subagents omit the time), with per-row actions.
 */
export default function SessionAgentTree({
  sessionId,
  agents,
  currentAgentId,
  canManage,
  onSelectAgent,
}) {
  const tree = buildSessionAgentTree(agents);
  const [busyAgentId, setBusyAgentId] = useState(null);
  const [pendingRemoveAgent, setPendingRemoveAgent] = useState(null);
  const [renamingAgentId, setRenamingAgentId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  if (!tree.length) return null;

  const handleStop = async (agent) => {
    if (!sessionId || !isAgentTurnActive(agent.status)) return;
    setBusyAgentId(agent.id);
    try {
      await agentsService.stop({ agent_id: agent.id });
    } catch (err) {
      toastError('Failed to stop agent', err);
    } finally {
      setBusyAgentId(null);
    }
  };

  const confirmRemove = (agent) => {
    if (!sessionId || !agent || !canRemoveAgentWhenIdle(agent)) return;
    setPendingRemoveAgent(agent);
  };

  const handleConfirmRemove = async () => {
    const agent = pendingRemoveAgent;
    if (!sessionId || !agent || !canRemoveAgentWhenIdle(agent)) return;
    setBusyAgentId(agent.id);
    try {
      await agentsService.remove(agent.id);
      setPendingRemoveAgent(null);
    } catch (err) {
      toastError('Failed to delete agent', err);
    } finally {
      setBusyAgentId(null);
    }
  };

  const startRename = (agent) => {
    setRenamingAgentId(agent.id);
    setRenameValue(agent.name?.trim() || agentDisplayTitle(agent));
  };

  const cancelRename = () => {
    if (renameSaving) return;
    setRenamingAgentId(null);
    setRenameValue('');
  };

  const commitRename = async (agent) => {
    if (renameSaving || renamingAgentId !== agent.id) return;
    const trimmed = renameValue.trim();
    const current = agent.name?.trim() || '';
    if (!trimmed || trimmed === current) {
      cancelRename();
      return;
    }
    setRenameSaving(true);
    try {
      await agentsService.patch(agent.id, { name: trimmed });
      setRenamingAgentId(null);
      setRenameValue('');
    } catch (err) {
      toastError('Failed to rename agent', err);
    } finally {
      setRenameSaving(false);
    }
  };

  const rowProps = {
    currentAgentId,
    canManage,
    busyAgentId,
    renamingAgentId,
    renameValue,
    renameSaving,
    onSelectAgent,
    onRenameChange: setRenameValue,
    onCommitRename: commitRename,
    onCancelRename: cancelRename,
    onStopAgent: handleStop,
    onRequestRename: startRename,
    onRequestRemove: confirmRemove,
  };

  const reviewerPending = pendingRemoveAgent?.agent_type === 'reviewer' ? pendingRemoveAgent : null;
  const builderPending =
    pendingRemoveAgent && pendingRemoveAgent.agent_type !== 'reviewer' ? pendingRemoveAgent : null;

  return (
    <>
      <ul className="mt-0.5 space-y-0.5 max-h-32 overflow-y-auto" data-testid="session-agent-tree">
        {tree.map((node) => (
          <AgentTreeRow key={node.agent.id} node={node} depth={0} {...rowProps} />
        ))}
      </ul>
      {reviewerPending && (
        <ClearReviewerChatConfirmModal
          loading={busyAgentId === reviewerPending.id}
          onCancel={() => {
            if (!busyAgentId) setPendingRemoveAgent(null);
          }}
          onConfirm={handleConfirmRemove}
        />
      )}
      {builderPending && (
        <DeleteAgentConfirmModal
          agent={builderPending}
          loading={busyAgentId === builderPending.id}
          onCancel={() => {
            if (!busyAgentId) setPendingRemoveAgent(null);
          }}
          onConfirm={handleConfirmRemove}
        />
      )}
    </>
  );
}
